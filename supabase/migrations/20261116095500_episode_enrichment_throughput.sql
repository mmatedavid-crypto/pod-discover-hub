-- Faster ingestion of already-paid output; no acceptance gate, cron or budget change.
CREATE OR REPLACE FUNCTION public.apply_episode_enrichment_chunk_v1(p_job uuid,p_token uuid,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='60s' AS $$
DECLARE j episode_enrichment_pilot_jobs; it episode_enrichment_pilot_items; x jsonb; out_rows jsonb:='[]'; run uuid;
BEGIN
 IF NOT episode_enrichment_allowed_v1() THEN RAISE EXCEPTION 'disabled'; END IF;
 SELECT * INTO j FROM episode_enrichment_pilot_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until IS NULL OR j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'job_lease'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'chunk_size'; END IF;
 INSERT INTO person_identity_repair_runs(version,summary) VALUES('episode-rich-v1-chunk',jsonb_build_object('job_id',p_job,'items',jsonb_array_length(p_items))) RETURNING id INTO run;
 FOR x IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  SELECT * INTO it FROM episode_enrichment_pilot_items WHERE episode_id=(x->>'episode_id')::uuid FOR UPDATE;
  IF it.episode_id IS NULL OR it.job_id IS DISTINCT FROM p_job OR it.fingerprint IS DISTINCT FROM x->>'fingerprint' THEN RAISE EXCEPTION 'chunk_item_mismatch'; END IF;
  IF it.status NOT IN('applied','stale','invalid','api_error') THEN
   IF it.status NOT IN('prepared','submitted') THEN RAISE EXCEPTION 'item_state'; END IF;
   IF x->>'cost' IS NULL OR (x->>'cost')::numeric<0 OR (x->>'cost')::numeric::text IN('NaN','Infinity') THEN RAISE EXCEPTION 'invalid_cost'; END IF;
   INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) VALUES(run,'episode_enrichment_pilot_items',to_jsonb(it));
   IF x ? 'error' THEN
    UPDATE episode_enrichment_pilot_items SET status='invalid',error=left(x->>'error',200),cost_usd=(x->>'cost')::numeric WHERE episode_id=it.episode_id;
   ELSE
    PERFORM apply_episode_enrichment_item_v1(it.episode_id,it.fingerprint,x->'result',x->'errors',x->'role_items',(x->>'cost')::numeric);
   END IF;
  END IF;
  out_rows:=out_rows||jsonb_build_array((SELECT jsonb_build_object('episode_id',episode_id,'fingerprint',fingerprint,'status',status) FROM episode_enrichment_pilot_items WHERE episode_id=it.episode_id));
 END LOOP;
 UPDATE person_identity_repair_runs SET completed_at=now(),summary=summary||jsonb_build_object('outcomes',out_rows) WHERE id=run;
 RETURN out_rows;
END $$;
REVOKE ALL ON FUNCTION public.apply_episode_enrichment_chunk_v1(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_episode_enrichment_chunk_v1(uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_episode_enrichment_job_v1(p_job uuid,p_token uuid,p_batch_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='15s' AS $$
DECLARE j episode_enrichment_pilot_jobs; total numeric; run uuid;
BEGIN
 IF NOT episode_enrichment_allowed_v1() THEN RAISE EXCEPTION 'disabled'; END IF;
 SELECT * INTO j FROM episode_enrichment_pilot_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until IS NULL OR j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'job_lease'; END IF;
 IF p_batch_status NOT IN('completed','expired','cancelled','failed') OR p_batch_status IS NULL THEN RAISE EXCEPTION 'batch_not_terminal'; END IF;
 INSERT INTO person_identity_repair_runs(version,summary) VALUES('episode-rich-v1-settle',jsonb_build_object('job_id',p_job)) RETURNING id INTO run;
 INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) VALUES(run,'episode_enrichment_pilot_jobs',to_jsonb(j));
 INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT run,'episode_enrichment_pilot_items',to_jsonb(i) FROM episode_enrichment_pilot_items i WHERE job_id=p_job AND status IN('prepared','submitted');
 UPDATE episode_enrichment_pilot_items SET status='api_error',error='batch_'||p_batch_status||'_without_output' WHERE job_id=p_job AND status IN('prepared','submitted');
 SELECT coalesce(sum(cost_usd),0) INTO total FROM episode_enrichment_pilot_items WHERE job_id=p_job;
 UPDATE episode_enrichment_pilot_jobs SET status='ingested',actual_cost_usd=total,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=p_job;
 UPDATE person_identity_repair_runs SET completed_at=now(),summary=summary||jsonb_build_object('actual_cost_usd',total) WHERE id=run;
 RETURN jsonb_build_object('job_id',p_job,'ingested',true,'actual_cost_usd',total);
END $$;
REVOKE ALL ON FUNCTION public.finish_episode_enrichment_job_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_episode_enrichment_job_v1(uuid,uuid,text) TO service_role;

-- Publication is a projection, not a reprocessing/payment or a person acceptance.
CREATE OR REPLACE FUNCTION public.episode_enrichment_content_quote_v1(p_quote text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(length(p_quote)>=15 AND p_quote !~* '(szponzor|támogatój[aá]|támogatásával|támogass|patreon|iratkozz|hírlevél|kuponkód|kedvezménykód|felvételek.{0,80}(készül|studios)|felvétel.{0,40}stúdió)',false)
$$;
REVOKE ALL ON FUNCTION public.episode_enrichment_content_quote_v1(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.episode_enrichment_content_quote_v1(text) TO service_role;
CREATE OR REPLACE FUNCTION public.get_episode_enrichment_public_v1(p_episode uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public SET statement_timeout='3s' AS $$
 WITH item AS MATERIALIZED (
  SELECT i.* FROM episode_enrichment_pilot_items i JOIN episodes e ON e.id=i.episode_id JOIN podcasts p ON p.id=e.podcast_id
  WHERE i.episode_id=p_episode AND i.status='applied' AND p.language_decision='accept_hungarian'
   AND EXISTS(SELECT 1 FROM app_settings WHERE key='episode_enrichment_pilot_controls' AND value->>'public_enabled'='true')
 ), current_source AS MATERIALIZED (SELECT episode_enrichment_input_v1(episode_id) data FROM item)
 SELECT jsonb_build_object(
  'questions',(SELECT coalesce(jsonb_agg(x->>'text'),'[]') FROM jsonb_array_elements(i.result->'questions')x WHERE episode_enrichment_content_quote_v1(x#>>'{evidence,quote}')),
  'entities',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',x->>'name','kind',x->>'kind')),'[]') FROM jsonb_array_elements(i.result->'entities')x WHERE episode_enrichment_content_quote_v1(x#>>'{evidence,quote}')),
  'format',CASE WHEN episode_enrichment_content_quote_v1(i.result#>>'{format,evidence,quote}') THEN i.result#>>'{format,label}' END)
 FROM item i CROSS JOIN current_source c
 -- Identity decisions/taxonomy changes do not invalidate public content. Source changes do.
 WHERE c.data->'sources'=i.input->'sources' AND c.data->>'clean_hash' IS NOT DISTINCT FROM i.input->>'clean_hash'
$$;
REVOKE ALL ON FUNCTION public.get_episode_enrichment_public_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_episode_enrichment_public_v1(uuid) TO anon,authenticated,service_role;
