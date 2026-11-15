-- Owner requested 10,000 DISTINCT episodes on 2026-11-15. Existing grant/caps unchanged.
-- Payments remain in person-relevance-openai-batch, charged to evidence_pilot.
-- No person-evidence quality gate is altered. LLM-only person roles remain proposals.
CREATE TABLE IF NOT EXISTS public.episode_enrichment_pilot_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL DEFAULT 'preparing',
 model text NOT NULL DEFAULT 'gpt-6-luna' CHECK(model='gpt-6-luna'),
 request_count integer NOT NULL DEFAULT 0, reserved_cost_usd numeric NOT NULL DEFAULT 0,
 actual_cost_usd numeric NOT NULL DEFAULT 0, openai_input_file_id text, openai_batch_id text,
 last_error text, lease_token uuid, lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.episode_enrichment_pilot_jobs TO service_role;
REVOKE ALL ON public.episode_enrichment_pilot_jobs FROM anon,authenticated;
ALTER TABLE public.episode_enrichment_pilot_jobs ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.episode_enrichment_pilot_items (
 episode_id uuid PRIMARY KEY REFERENCES public.episodes(id), ordinal integer NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'selected', job_id uuid REFERENCES public.episode_enrichment_pilot_jobs(id),
 input jsonb, fingerprint text, result jsonb, validation_errors jsonb, apply_report jsonb,
 before_state jsonb, cost_usd numeric NOT NULL DEFAULT 0, error text,
 source_pair_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz
);
GRANT ALL ON public.episode_enrichment_pilot_items TO service_role;
REVOKE ALL ON public.episode_enrichment_pilot_items FROM anon,authenticated;
ALTER TABLE public.episode_enrichment_pilot_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS episode_enrichment_pilot_items_status_idx ON public.episode_enrichment_pilot_items(status,ordinal);
DROP TRIGGER IF EXISTS episode_enrichment_budget ON public.episode_enrichment_pilot_jobs;
CREATE TRIGGER episode_enrichment_budget AFTER INSERT OR UPDATE ON public.episode_enrichment_pilot_jobs
 FOR EACH ROW EXECUTE FUNCTION public.external_ai_budget_job_sync('episode_enrichment_pilot','evidence_pilot');

CREATE OR REPLACE FUNCTION public.episode_enrichment_allowed_v1(p_require_enabled boolean DEFAULT true)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM app_settings WHERE key='background_jobs' AND value->>'enabled'='true' AND coalesce(value->>'incident_mode','false')='false')
 AND EXISTS(SELECT 1 FROM app_settings WHERE key='person_backlog_completion_controls' AND value->>'enabled'='true')
 AND (NOT p_require_enabled OR EXISTS(SELECT 1 FROM app_settings WHERE key='episode_enrichment_pilot_controls' AND value->>'enabled'='true'))
$$;

CREATE OR REPLACE FUNCTION public.episode_enrichment_input_v1(p_episode uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; c record; pl record; s jsonb; v jsonb; people_json jsonb; anchor_id uuid; page text;
BEGIN
 SELECT ep.*,p.title podcast_title,p.description podcast_description INTO e FROM episodes ep JOIN podcasts p ON p.id=ep.podcast_id
 WHERE ep.id=p_episode AND p.language_decision='accept_hungarian';
 IF e.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO c FROM get_episode_derivation_inputs_v1(ARRAY[p_episode]);
 SELECT * INTO pl FROM person_role_label_platform_v1(e.id,e.podcast_id,e.published_at);
 SELECT g.page_description INTO page FROM episode_public_page_evidence g WHERE g.episode_id=e.id AND g.status='ok' AND g.url=e.episode_url;
 SELECT d.person_id INTO anchor_id FROM person_pair_dispositions d WHERE d.episode_id=e.id ORDER BY d.person_id LIMIT 1;
 IF anchor_id IS NULL THEN RETURN NULL; END IF;
 v := person_evidence_source_v1(anchor_id,e.id);
 s := jsonb_build_array(jsonb_build_object('id','title','kind','episode_title','scope','episode','url',e.episode_url,'text',e.title),
   jsonb_build_object('id','rss','kind','episode_description','scope','episode','url',e.episode_url,'text',coalesce(v#>>'{episode,description}','')),
   jsonb_build_object('id','clean','kind','clean_text','scope','episode','url',e.episode_url,'text',coalesce(v#>>'{clean_text,text}','')),
   jsonb_build_object('id','transcript','kind','transcript','scope','episode','url',e.episode_url,'text',coalesce(v#>>'{transcript,text}','')),
   jsonb_build_object('id','show','kind','show_description','scope','show','url',NULL,'text',coalesce(v#>>'{podcast,description}','')));
 IF pl.sp_text IS NOT NULL THEN s := s || jsonb_build_object('id','spotify','kind','spotify_episode_description','scope','episode','url',pl.sp_src->>'source_url','text',left(pl.sp_text,20000)); END IF;
 IF pl.yt_text IS NOT NULL THEN s := s || jsonb_build_object('id','youtube','kind','youtube_episode_description','scope','episode','url',pl.yt_src->>'source_url','text',left(pl.yt_text,20000)); END IF;
 IF page IS NOT NULL THEN s := s || jsonb_build_object('id','publisher','kind','episode_page','scope','episode','url',e.episode_url,'text',left(page,6000)); END IF;
 SELECT coalesce(jsonb_agg(x.data ORDER BY x.pid),'[]') INTO people_json FROM (
  SELECT pe.id pid,jsonb_build_object('id',pe.id,'name',pe.name,'aliases',a.names,'context',left(pe.disambiguation_context,600),
    'identity_risk',coalesce(pe.identity_ambiguous,false) OR EXISTS(SELECT 1 FROM people other WHERE other.normalized_name=pe.normalized_name AND other.id<>pe.id AND other.is_public),
    'role_source_hash',person_role_label_source_hash_v1(pe.name,a.names,e.title,e.description,page,pl.sig)) data
  FROM person_pair_dispositions d JOIN people pe ON pe.id=d.person_id
  CROSS JOIN LATERAL(SELECT ARRAY(SELECT aa.alias FROM person_aliases aa WHERE aa.person_id=pe.id AND aa.status='accepted' AND
    ((aa.scope='global' AND aa.source='owner_verified_name_variant_v1') OR (aa.scope='podcast' AND aa.scope_podcast_id=e.podcast_id) OR (aa.scope='episode' AND aa.scope_episode_id=e.id)) ORDER BY aa.alias) names)a
  WHERE d.episode_id=e.id AND d.disposition NOT IN('decided_accepted','decided_rejected','resolved_show_host')
    AND coalesce(d.decided_by,'') !~* 'human|manual|chatgpt|external_review'
  ORDER BY pe.id LIMIT 30
 )x;
 v := jsonb_build_object('episode_id',e.id,'title',e.title,'published_at',e.published_at,'podcast_title',e.podcast_title,
  'clean_hash',CASE WHEN length(coalesce(v#>>'{clean_text,text}',''))>0 THEN c.clean_hash ELSE NULL END,'sources',s,'people',people_json,
  'taxonomy',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) ORDER BY t.id) FROM topics t WHERE t.is_public),'[]'));
 RETURN v || jsonb_build_object('fingerprint',md5(v::text));
END $$;

CREATE OR REPLACE FUNCTION public.seed_episode_enrichment_pilot_v1(p_token uuid,p_limit integer DEFAULT 10000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='170s' AS $$
DECLARE n integer; run uuid; ctl jsonb;
BEGIN
 SELECT value INTO ctl FROM app_settings WHERE key='person_backlog_completion_controls' FOR UPDATE;
 IF NOT episode_enrichment_allowed_v1(false) OR ctl->>'run_token' IS DISTINCT FROM p_token::text OR (ctl->>'lease_until')::timestamptz<=now() THEN RAISE EXCEPTION 'lease_or_controls'; END IF;
 IF EXISTS(SELECT 1 FROM episode_enrichment_pilot_items) THEN RETURN jsonb_build_object('selected',(SELECT count(*) FROM episode_enrichment_pilot_items),'unchanged',true); END IF;
 INSERT INTO person_identity_repair_runs(version,summary) VALUES('episode-rich-v1-cohort',jsonb_build_object('action','select_only','max_episodes',least(p_limit,10000),'paid_calls',0)) RETURNING id INTO run;
 WITH candidates AS MATERIALIZED (
 SELECT e.id,e.podcast_id,e.published_at,count(*) pair_count,
  row_number() OVER(PARTITION BY e.podcast_id ORDER BY count(*) DESC,e.published_at DESC NULLS LAST,e.id) show_rank
 FROM person_identity_repair_backup b JOIN person_pair_dispositions d ON d.person_id=(b.row_data->>'person_id')::uuid AND d.episode_id=(b.row_data->>'episode_id')::uuid
 JOIN episodes e ON e.id=d.episode_id JOIN podcasts p ON p.id=e.podcast_id
 WHERE b.run_id='20950887-ea45-4456-b801-fb091aae5f98' AND b.table_name='person_backlog_target'
 AND d.disposition NOT IN('decided_accepted','decided_rejected','resolved_show_host') AND p.language_decision='accept_hungarian'
 AND (length(coalesce(e.description,''))>=100 OR EXISTS(SELECT 1 FROM episode_spotify_meta sp WHERE sp.episode_id=e.id AND sp.podcast_id=e.podcast_id AND sp.match_confidence>=0.8 AND sp.release_date=e.published_at::date AND length(sp.spotify_description)>=100))
 GROUP BY e.id,e.podcast_id,e.published_at
 ), chosen AS(SELECT *,row_number() OVER(ORDER BY show_rank,pair_count DESC,published_at DESC NULLS LAST,id) ordinal FROM candidates ORDER BY show_rank,pair_count DESC,published_at DESC NULLS LAST,id LIMIT least(greatest(p_limit,1),10000))
 INSERT INTO episode_enrichment_pilot_items(episode_id,ordinal,source_pair_count) SELECT id,ordinal,pair_count FROM chosen;
 GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT run,'episode_enrichment_pilot_target',jsonb_build_object('episode_id',episode_id,'ordinal',ordinal,'source_pair_count',source_pair_count) FROM episode_enrichment_pilot_items;
 UPDATE person_identity_repair_runs SET completed_at=now(),summary=summary||jsonb_build_object('selected',n,'closed_pairs',0) WHERE id=run;
 RETURN jsonb_build_object('selected',n,'repair_run',run,'paid_calls',0,'closed_pairs',0);
END $$;

CREATE OR REPLACE FUNCTION public.claim_episode_enrichment_job_v1(p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='120s' AS $$
DECLARE j uuid; n integer; token uuid:=gen_random_uuid(); r record; v jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('episode-enrichment-pilot'));
 IF NOT episode_enrichment_allowed_v1() THEN RETURN jsonb_build_object('blocked','disabled'); END IF;
 IF (SELECT count(*) FROM episode_enrichment_pilot_jobs WHERE status NOT IN('ingested','aborted','failed'))>=12 THEN RETURN jsonb_build_object('blocked','max_open_jobs'); END IF;
 IF NOT EXISTS(SELECT 1 FROM episode_enrichment_pilot_items WHERE status='selected') THEN RETURN jsonb_build_object('blocked','no_selected'); END IF;
 INSERT INTO episode_enrichment_pilot_jobs(lease_token,lease_until) VALUES(token,now()+interval '5 minutes') RETURNING id INTO j;
 FOR r IN SELECT episode_id FROM episode_enrichment_pilot_items WHERE status='selected' ORDER BY ordinal LIMIT least(greatest(p_limit,1),500) FOR UPDATE SKIP LOCKED LOOP
  v:=episode_enrichment_input_v1(r.episode_id);
  UPDATE episode_enrichment_pilot_items SET job_id=j,input=v,fingerprint=v->>'fingerprint',status=CASE WHEN v IS NULL THEN 'source_unavailable' ELSE 'prepared' END WHERE episode_id=r.episode_id;
 END LOOP;
 SELECT count(*) INTO n FROM episode_enrichment_pilot_items WHERE job_id=j AND status='prepared';
 UPDATE episode_enrichment_pilot_jobs SET request_count=n,status=CASE WHEN n=0 THEN 'aborted' ELSE 'preparing' END WHERE id=j;
 RETURN jsonb_build_object('job_id',j,'lease_token',token,'count',n,'items',(SELECT jsonb_agg(input ORDER BY ordinal) FROM episode_enrichment_pilot_items WHERE job_id=j AND status='prepared'));
END $$;

CREATE OR REPLACE FUNCTION public.apply_episode_enrichment_item_v1(p_episode uuid,p_fingerprint text,p_result jsonb,p_errors jsonb,p_role_items jsonb,p_cost numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='120s' AS $$
DECLARE it episode_enrichment_pilot_items; live jsonb; e record; rep jsonb:='{}'; x jsonb; ev jsonb; run uuid; topics_json jsonb; old_links jsonb;
BEGIN
 IF NOT episode_enrichment_allowed_v1() THEN RAISE EXCEPTION 'disabled'; END IF;
 SELECT * INTO it FROM episode_enrichment_pilot_items WHERE episode_id=p_episode FOR UPDATE;
 IF it.status IN('applied','stale','invalid') THEN RETURN coalesce(it.apply_report,jsonb_build_object('status',it.status)); END IF;
 IF it.status NOT IN('submitted','prepared') OR it.fingerprint IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'item_state'; END IF;
 live:=episode_enrichment_input_v1(p_episode);
 IF live->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN
  UPDATE episode_enrichment_pilot_items SET status='stale',cost_usd=p_cost,error='source_changed' WHERE episode_id=p_episode;
  RETURN jsonb_build_object('status','stale');
 END IF;
 -- Verify every quote again server-side. Show context cannot justify public episode fields.
 FOR x IN SELECT value FROM jsonb_array_elements(coalesce(p_result->'topics','[]')||coalesce(p_result->'questions','[]')||coalesce(p_result->'entities','[]')||CASE WHEN jsonb_typeof(p_result->'format')='object' THEN jsonb_build_array(p_result->'format') ELSE '[]'::jsonb END) LOOP
  ev:=x->'evidence';
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(it.input->'sources') s WHERE s->>'id'=ev->>'source' AND s->>'scope'='episode' AND length(ev->>'quote')>=15 AND position(regexp_replace(ev->>'quote','\s+',' ','g') IN regexp_replace(s->>'text','\s+',' ','g'))>0) THEN RAISE EXCEPTION 'evidence_mismatch'; END IF;
 END LOOP;
 FOR ev IN SELECT value FROM jsonb_array_elements(coalesce(p_result#>'{summary,evidence}','[]')) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(it.input->'sources') s WHERE s->>'id'=ev->>'source' AND s->>'scope'='episode' AND length(ev->>'quote')>=15 AND position(regexp_replace(ev->>'quote','\s+',' ','g') IN regexp_replace(s->>'text','\s+',' ','g'))>0) THEN RAISE EXCEPTION 'summary_evidence_mismatch'; END IF;
 END LOOP;
 SELECT * INTO e FROM episodes WHERE id=p_episode FOR UPDATE;
 INSERT INTO person_identity_repair_runs(version,summary) VALUES('episode-rich-v1-apply',jsonb_build_object('episode_id',p_episode,'job_id',it.job_id)) RETURNING id INTO run;
 INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) VALUES(run,'episodes',to_jsonb(e));
 INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT run,'episode_extracted_topics',to_jsonb(t) FROM episode_extracted_topics t WHERE episode_id=p_episode;
 INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT run,'episode_derivation_state',to_jsonb(s) FROM episode_derivation_state s WHERE episode_id=p_episode;
 INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT run,'episode_topic_map',to_jsonb(s) FROM episode_topic_map s WHERE episode_id=p_episode;
 SELECT coalesce(jsonb_agg(topic_id),'[]') INTO old_links FROM episode_topic_map WHERE episode_id=p_episode;
 IF nullif(btrim(e.ai_summary),'') IS NULL AND length(coalesce(p_result#>>'{summary,text}','')) BETWEEN 30 AND 350 AND jsonb_array_length(coalesce(p_result#>'{summary,evidence}','[]'))>0 THEN
  rep:=rep||jsonb_build_object('summary',apply_episode_seo_result_v1(p_episode,it.input->>'clean_hash','description',jsonb_build_object('ai_summary',p_result#>>'{summary,text}','ai_summary_source','episode-rich-v1','seo_title',e.seo_title,'seo_description',e.seo_description)));
 ELSE rep:=rep||jsonb_build_object('summary','preserved_existing_or_no_evidence'); END IF;
 IF NOT EXISTS(SELECT 1 FROM episode_extracted_topics WHERE episode_id=p_episode) AND jsonb_array_length(p_result->'topics')>0 THEN
  SELECT jsonb_agg(jsonb_build_object('raw_label',t->>'label','normalized_label',lower(t->>'label'),'kind','subject','confidence',0.9,'rationale',t#>>'{evidence,quote}','model','gpt-6-luna')) INTO topics_json FROM jsonb_array_elements(p_result->'topics')t;
  rep:=rep||jsonb_build_object('topics',apply_episode_topics_v1(p_episode,it.input->>'clean_hash',topics_json,1));
 ELSE rep:=rep||jsonb_build_object('topics','preserved_existing_or_no_evidence'); END IF;
 -- Real topic-page links, not only extracted labels. Existing links never overwritten.
 INSERT INTO episode_topic_map(episode_id,topic_id,confidence,source)
 SELECT p_episode,t.id,0.9,'episode-rich-v1' FROM jsonb_array_elements(p_result->'topics') topic_row JOIN topics t ON t.id::text=topic_row->>'topic_id' WHERE t.is_public
 ON CONFLICT(episode_id,topic_id) DO NOTHING;
 -- Only the existing deterministic parser + existing identity/lease/decision RPC can accept people.
 IF jsonb_array_length(coalesce(p_role_items,'[]'))>30 THEN RAISE EXCEPTION 'too_many_role_items'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_role_items,'[]')) r WHERE r->>'episode_id'<>p_episode::text OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(it.input->'people') pe WHERE pe->>'id'=r->>'person_id')) THEN RAISE EXCEPTION 'person_item_mismatch'; END IF;
 rep:=rep||jsonb_build_object('people',apply_person_role_label_v1(coalesce(p_role_items,'[]')),'llm_only_roles','quality_gate_pending','repair_run',run);
 FOR x IN SELECT value FROM jsonb_array_elements(rep->'people') WHERE value->>'outcome'='applied' LOOP
  INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT run,'people',to_jsonb(pe) FROM people pe WHERE pe.id=(x->>'person_id')::uuid;
  UPDATE people pe SET episode_count=z.ec,gated_episode_count=z.ec,podcast_count=z.pc,gated_podcast_count=z.pc
  FROM (SELECT count(DISTINCT episode_id)::integer ec,count(DISTINCT podcast_id)::integer pc FROM person_public_episode_links_v1 WHERE person_id=(x->>'person_id')::uuid)z WHERE pe.id=(x->>'person_id')::uuid;
 END LOOP;
 rep:=rep||jsonb_build_object('old_topic_ids',old_links,'after_episode',(SELECT jsonb_build_object('ai_summary',ai_summary,'ai_summary_source',ai_summary_source,'seo_title',seo_title,'seo_description',seo_description,'ai_enriched_at',ai_enriched_at) FROM episodes WHERE id=p_episode));
 UPDATE episode_enrichment_pilot_items SET status='applied',result=p_result,validation_errors=p_errors,apply_report=rep,before_state=to_jsonb(e),cost_usd=p_cost,applied_at=now() WHERE episode_id=p_episode;
 UPDATE person_identity_repair_runs SET completed_at=now(),summary=summary||rep WHERE id=run;
 RETURN rep;
END $$;

-- Only derived labels/questions are public. Sources, quotes, transcripts, identities and internal errors stay private.
CREATE OR REPLACE FUNCTION public.get_episode_enrichment_public_v1(p_episode uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('questions',(SELECT coalesce(jsonb_agg(x->>'text'),'[]') FROM jsonb_array_elements(i.result->'questions')x),
 'entities',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',x->>'name','kind',x->>'kind')),'[]') FROM jsonb_array_elements(i.result->'entities')x),
 'format',i.result#>>'{format,label}') FROM episode_enrichment_pilot_items i JOIN episodes e ON e.id=i.episode_id JOIN podcasts p ON p.id=e.podcast_id
 WHERE i.episode_id=p_episode AND i.status='applied' AND p.language_decision='accept_hungarian'
 AND EXISTS(SELECT 1 FROM app_settings WHERE key='episode_enrichment_pilot_controls' AND value->>'public_enabled'='true')
$$;
CREATE OR REPLACE FUNCTION public.episode_enrichment_pilot_counts_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('selected',count(*),'applied',count(*) FILTER(WHERE status='applied'),
 'submitted',count(*) FILTER(WHERE status='submitted'),'pending',count(*) FILTER(WHERE status IN('selected','prepared')),
 'stale',count(*) FILTER(WHERE status='stale'),'invalid',count(*) FILTER(WHERE status IN('invalid','api_error','source_unavailable')),
 'actual_cost_usd',coalesce(sum(cost_usd),0),'by_status',(SELECT jsonb_object_agg(status,n) FROM (SELECT status,count(*) n FROM episode_enrichment_pilot_items GROUP BY status)s)) FROM episode_enrichment_pilot_items
$$;
CREATE OR REPLACE FUNCTION public.undo_episode_enrichment_item_v1(p_episode uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE it episode_enrichment_pilot_items; ctl jsonb; current_fields jsonb; original episodes; role_audits bigint[]; old_run uuid; outcome jsonb;
BEGIN
 SELECT value INTO ctl FROM app_settings WHERE key='person_backlog_completion_controls' FOR UPDATE;
 IF NOT episode_enrichment_allowed_v1(false) OR ctl->>'run_token' IS DISTINCT FROM p_token::text OR (ctl->>'lease_until')::timestamptz<=now() THEN RAISE EXCEPTION 'lease_or_controls'; END IF;
 SELECT * INTO it FROM episode_enrichment_pilot_items WHERE episode_id=p_episode FOR UPDATE;
 IF it.status IS DISTINCT FROM 'applied' THEN RETURN jsonb_build_object('status','not_applied'); END IF;
 PERFORM 1 FROM episodes WHERE id=p_episode FOR UPDATE;
 SELECT jsonb_build_object('ai_summary',ai_summary,'ai_summary_source',ai_summary_source,'seo_title',seo_title,'seo_description',seo_description,'ai_enriched_at',ai_enriched_at) INTO current_fields FROM episodes WHERE id=p_episode;
 IF current_fields IS DISTINCT FROM it.apply_report->'after_episode' THEN RETURN jsonb_build_object('status','blocked_newer_edit'); END IF;
 old_run:=(it.apply_report->>'repair_run')::uuid;
 original:=jsonb_populate_record(NULL::episodes,it.before_state);
 -- Preserve all independent changes; remove only topic links owned by this application.
 DELETE FROM episode_topic_map t WHERE t.episode_id=p_episode AND t.source='episode-rich-v1'
  AND NOT (coalesce(it.apply_report->'old_topic_ids','[]') ? t.topic_id::text);
 IF it.apply_report->>'topics' NOT IN('preserved_existing_or_no_evidence','superseded') THEN
  IF EXISTS(SELECT 1 FROM episode_extracted_topics WHERE episode_id=p_episode AND (model IS DISTINCT FROM 'gpt-6-luna' OR created_at>it.applied_at+interval '1 second')) THEN RAISE EXCEPTION 'newer_topics_prevent_undo'; END IF;
  DELETE FROM episode_extracted_topics WHERE episode_id=p_episode AND model='gpt-6-luna';
  UPDATE episodes SET topic_extraction_status=original.topic_extraction_status,topic_extraction_version=original.topic_extraction_version,topic_extracted_at=original.topic_extracted_at WHERE id=p_episode;
 END IF;
 UPDATE episodes SET ai_summary=original.ai_summary,ai_summary_source=original.ai_summary_source,seo_title=original.seo_title,seo_description=original.seo_description,ai_enriched_at=original.ai_enriched_at WHERE id=p_episode;
 -- A fresh derivation is requested rather than incorrectly certifying the restored source as current.
 UPDATE episode_derivation_state SET seo_status='stale',topic_status='stale',updated_at=now() WHERE episode_id=p_episode;
 SELECT array_agg((x->>'audit_id')::bigint) INTO role_audits FROM jsonb_array_elements(coalesce(it.apply_report->'people','[]'))x WHERE x->>'outcome'='applied';
 IF cardinality(role_audits)>0 THEN outcome:=undo_person_role_label_v1(role_audits,false,'episode-rich-v1-rollback'); END IF;
 UPDATE episode_enrichment_pilot_items SET status='rolled_back',apply_report=apply_report||jsonb_build_object('rolled_back_at',now(),'person_undo',outcome) WHERE episode_id=p_episode;
 INSERT INTO person_identity_repair_runs(version,completed_at,summary) VALUES('episode-rich-v1-undo',now(),jsonb_build_object('episode_id',p_episode,'original_run',old_run,'person_undo',outcome));
 RETURN jsonb_build_object('status','rolled_back','person_undo',outcome);
END $$;
-- A finished pilot releases the normal worker. Reservations in flight are allowed to settle.
-- A genuinely exhausted cap stops new submissions without abandoning already paid outputs.
CREATE OR REPLACE FUNCTION public.episode_enrichment_progress_v1(p_event text,p_detail text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ctl jsonb; active_jobs integer; batch_size integer;
BEGIN
 IF NOT episode_enrichment_allowed_v1(false) THEN RAISE EXCEPTION 'disabled'; END IF;
 SELECT value INTO ctl FROM app_settings WHERE key='episode_enrichment_pilot_controls' FOR UPDATE;
 SELECT count(*) INTO active_jobs FROM episode_enrichment_pilot_jobs WHERE status NOT IN('ingested','aborted','failed');
 IF p_event='finish' AND active_jobs=0 AND NOT EXISTS(SELECT 1 FROM episode_enrichment_pilot_items WHERE status IN('selected','prepared','submitted')) THEN
  UPDATE app_settings SET value=value||jsonb_build_object('enabled',false,'reason','completed','completed_at',now()) WHERE key='episode_enrichment_pilot_controls';
 ELSIF p_event='budget_blocked' AND active_jobs=0 THEN
  batch_size:=coalesce((ctl->>'max_requests_per_job')::integer,500);
  IF batch_size>1 THEN
   UPDATE app_settings SET value=value||jsonb_build_object('max_requests_per_job',greatest(1,batch_size/2),'last_budget_block',p_detail) WHERE key='episode_enrichment_pilot_controls';
  ELSE
   UPDATE app_settings SET value=value||jsonb_build_object('submit_paused_reason','budget_limit','last_budget_block',p_detail,'paused_at',now()) WHERE key='episode_enrichment_pilot_controls';
  END IF;
 END IF;
 RETURN (SELECT value FROM app_settings WHERE key='episode_enrichment_pilot_controls');
END $$;
REVOKE ALL ON FUNCTION public.episode_enrichment_progress_v1(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.episode_enrichment_progress_v1(text,text) TO service_role;
REVOKE ALL ON FUNCTION public.undo_episode_enrichment_item_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.undo_episode_enrichment_item_v1(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.episode_enrichment_pilot_counts_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.episode_enrichment_pilot_counts_v1() TO service_role;
REVOKE ALL ON FUNCTION public.episode_enrichment_allowed_v1(boolean),public.episode_enrichment_input_v1(uuid),public.seed_episode_enrichment_pilot_v1(uuid,integer),public.claim_episode_enrichment_job_v1(integer),public.apply_episode_enrichment_item_v1(uuid,text,jsonb,jsonb,jsonb,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.episode_enrichment_allowed_v1(boolean),public.episode_enrichment_input_v1(uuid),public.seed_episode_enrichment_pilot_v1(uuid,integer),public.claim_episode_enrichment_job_v1(integer),public.apply_episode_enrichment_item_v1(uuid,text,jsonb,jsonb,jsonb,numeric) TO service_role;
REVOKE ALL ON FUNCTION public.get_episode_enrichment_public_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_episode_enrichment_public_v1(uuid) TO anon,authenticated,service_role;
INSERT INTO app_settings(key,value) VALUES('episode_enrichment_pilot_controls',jsonb_build_object('enabled',false,'public_enabled',false,'target_episodes',10000,'model','gpt-6-luna','policy','episode-rich-v1','budget_lane','evidence_pilot','max_requests_per_job',500,'reason','awaiting_worker_deployment','authorized_by','Máté: 10000 epizódos közös próba, 2026-11-15','person_ai_auto_apply',false)) ON CONFLICT(key) DO NOTHING;
