-- Apply through Lovable Cloud migration tooling. No operational records in source control.
CREATE TABLE IF NOT EXISTS public.person_relevance_work (
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  claim_token uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  source_hash text NOT NULL,
  cached_hash text,
  cached_decision jsonb,
  model_used text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, episode_id)
);
REVOKE ALL ON public.person_relevance_work FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.person_relevance_work TO service_role;
ALTER TABLE public.person_relevance_work ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.person_judge_source(_person uuid, _episode uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
 SELECT jsonb_build_object(
  'person', jsonb_build_object('name', person.name,
    'aliases', COALESCE((SELECT jsonb_agg(a.alias ORDER BY a.alias) FROM person_aliases a WHERE a.person_id=_person), '[]'::jsonb),
    'disambiguation_label',person.disambiguation_label,'disambiguation_context',left(person.disambiguation_context,800)),
  'episode', jsonb_build_object('id',e.id,'title',e.title,'summary',left(COALESCE(e.summary,''),1200),
    'clean_text',left(COALESCE(clean.cleaned_text,''),6000),'clean_hash',md5(COALESCE(clean.cleaned_text,''))),
  'podcast',jsonb_build_object('title',p.title,'description',left(COALESCE(p.description,''),400)),
  'mentions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'mention_type',m.mention_type,
    'confidence',m.confidence,'evidence',left(m.evidence,500),'role_type',m.role_type,
    'relevance_status',m.relevance_status,'validation_source',m.validation_source,'ai_judged_at',m.ai_judged_at) ORDER BY m.id)
    FROM person_episode_mentions m WHERE m.person_id=_person AND m.episode_id=_episode),'[]'::jsonb))
 FROM people person CROSS JOIN episodes e JOIN podcasts p ON p.id=e.podcast_id
 LEFT JOIN LATERAL (SELECT ect.cleaned_text FROM episode_clean_text ect WHERE ect.episode_id=e.id
   AND ect.cleaner_method LIKE 'deterministic_v4%' LIMIT 1) clean ON true
 WHERE person.id=_person AND e.id=_episode;
$$;

-- One runner at a time bounds budget concurrency and prevents parallel admin/cron drains.
CREATE OR REPLACE FUNCTION public.person_judge_run_lease(_token uuid, _release boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE got boolean := false;
BEGIN
 IF _release THEN
  UPDATE app_settings SET value='{}'::jsonb,updated_at=now()
  WHERE key='person_relevance_judge_lease' AND value->>'token'=_token::text;
  RETURN FOUND;
 END IF;
 INSERT INTO app_settings(key,value,updated_at)
 VALUES('person_relevance_judge_lease',jsonb_build_object('token',_token,'until',now()+interval '180 seconds'),now())
 ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()
 WHERE COALESCE((app_settings.value->>'until')::timestamptz,'-infinity'::timestamptz)<now()
 RETURNING true INTO got;
 RETURN COALESCE(got,false);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_person_judge_pairs(_limit integer, _token uuid, _person_ids uuid[] DEFAULT NULL)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET statement_timeout='15s' AS $$
DECLARE r record; src jsonb; work public.person_relevance_work; cap integer; ctrl jsonb;
BEGIN
 SELECT value INTO ctrl FROM app_settings WHERE key='person_relevance_judge_controls';
 IF COALESCE((ctrl->>'enabled')::boolean,false) IS NOT TRUE THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM app_settings WHERE key='background_jobs' AND
   (value->>'enabled'='false' OR value->>'incident_mode'='true')) THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM app_settings WHERE key='person_relevance_judge_lease'
   AND value->>'token'=_token::text AND (value->>'until')::timestamptz>now()) THEN RETURN; END IF;
 cap := LEAST(GREATEST(_limit,1),GREATEST(COALESCE((ctrl->>'batch_limit')::integer,40),1),200);
 FOR r IN
  SELECT DISTINCT ON (ranked.is_public,ranked.published_at,ranked.person_id,ranked.episode_id)
    ranked.person_id,ranked.episode_id,ranked.is_public,ranked.published_at
  FROM (
   SELECT m.person_id,m.episode_id,person.is_public,e.published_at
   FROM person_episode_mentions m JOIN people person ON person.id=m.person_id
   JOIN episodes e ON e.id=m.episode_id JOIN podcasts p ON p.id=m.podcast_id
   LEFT JOIN person_relevance_work w ON w.person_id=m.person_id AND w.episode_id=m.episode_id
   WHERE (m.relevance_status='pending' OR (m.relevance_status='in_progress' AND m.ai_judged_at<now()-interval '5 minutes'))
    AND p.is_hungarian=true AND p.language_decision='accept_hungarian'
    AND (_person_ids IS NULL OR m.person_id=ANY(_person_ids))
    AND (w.person_id IS NULL OR w.lease_until<now())
  ) ranked
  ORDER BY ranked.is_public DESC NULLS LAST,ranked.published_at DESC NULLS LAST,ranked.person_id,ranked.episode_id
  LIMIT cap
 LOOP
  src := public.person_judge_source(r.person_id,r.episode_id);
  INSERT INTO person_relevance_work(person_id,episode_id,claim_token,lease_until,source_hash)
  VALUES(r.person_id,r.episode_id,_token,now()+interval '180 seconds',md5(src::text))
  ON CONFLICT(person_id,episode_id) DO UPDATE SET claim_token=_token,lease_until=EXCLUDED.lease_until,
    source_hash=EXCLUDED.source_hash,updated_at=now()
  WHERE person_relevance_work.lease_until<now()
  RETURNING * INTO work;
  IF FOUND THEN
   RETURN NEXT jsonb_build_object('person_id',r.person_id,'episode_id',r.episode_id,'source_hash',work.source_hash,
    'cached_decision',CASE WHEN work.cached_hash=work.source_hash THEN work.cached_decision ELSE NULL END,
    'model_used',work.model_used,'input',src);
  END IF;
 END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_person_judge_pair(_person uuid, _episode uuid, _token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.person_relevance_work; d jsonb; canonical uuid; before_rows jsonb;
  wanted text; role text; result_status text; changed integer; protected boolean;
BEGIN
 SELECT * INTO w FROM person_relevance_work WHERE person_id=_person AND episode_id=_episode FOR UPDATE;
 IF NOT FOUND OR w.claim_token<>_token OR w.lease_until<now() THEN RAISE EXCEPTION 'stale_claim'; END IF;
 IF w.cached_hash IS DISTINCT FROM w.source_hash OR w.cached_decision IS NULL THEN RAISE EXCEPTION 'missing_cached_decision'; END IF;
 PERFORM 1 FROM person_episode_mentions WHERE person_id=_person AND episode_id=_episode ORDER BY id FOR UPDATE;
 IF md5(public.person_judge_source(_person,_episode)::text) IS DISTINCT FROM w.source_hash THEN RAISE EXCEPTION 'source_changed'; END IF;
 d:=w.cached_decision; result_status:=d->>'status'; wanted:=d->>'mention_type';
 IF result_status NOT IN ('accepted','rejected','needs_review','waiting_clean_text') OR result_status IS NULL
   OR wanted NOT IN ('host','guest','subject','mentioned','none') OR wanted IS NULL
   OR COALESCE((d->>'score')::numeric,-1) NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION 'invalid_decision'; END IF;
 IF result_status='accepted' AND (wanted='none' OR d->>'identity_match' IS DISTINCT FROM 'same_person'
   OR (d->>'score')::numeric<0.85 OR jsonb_array_length(COALESCE(d->'evidence_phrases','[]'))=0) THEN RAISE EXCEPTION 'unsafe_acceptance'; END IF;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id),bool_or(COALESCE(m.validation_source,'')~*'manual|chatgpt|external_review')
 INTO before_rows,protected FROM person_episode_mentions m WHERE m.person_id=_person AND m.episode_id=_episode;
 IF protected THEN
  UPDATE person_episode_mentions SET relevance_status='needs_review',validation_source='person_pairs_v1',
    ai_reason='Kézzel ellenőrzött kapcsolat védelme; külön ellenőrzés szükséges.',ai_judged_at=now()
  WHERE person_id=_person AND episode_id=_episode AND relevance_status IN ('pending','in_progress')
    AND COALESCE(validation_source,'')!~*'manual|chatgpt|external_review';
  result_status:='needs_review';
 ELSE
  -- Reuse an existing desired role rather than colliding with the unique role key.
  SELECT id INTO canonical FROM person_episode_mentions WHERE person_id=_person AND episode_id=_episode
  ORDER BY (mention_type=wanted) DESC,id LIMIT 1;
  role:=CASE wanted WHEN 'host' THEN 'participant' WHEN 'guest' THEN 'participant' WHEN 'subject' THEN 'subject' ELSE 'mention' END;
  UPDATE person_episode_mentions SET
    relevance_status=CASE WHEN result_status='accepted' AND id<>canonical THEN 'rejected' ELSE result_status END,
    mention_type=CASE WHEN result_status='accepted' AND id=canonical THEN wanted ELSE mention_type END,
    role_type=CASE WHEN result_status='accepted' AND id=canonical THEN role ELSE role_type END,
    role_confidence=CASE WHEN result_status='accepted' AND id=canonical THEN (d->>'score')::numeric ELSE role_confidence END,
    role_reason=CASE WHEN result_status='accepted' AND id=canonical THEN d->>'reason' ELSE role_reason END,
    final_relevance_score=CASE WHEN result_status='accepted' AND id<>canonical THEN 0 ELSE (d->>'score')::numeric END,
    validation_source='person_pairs_v1',ai_identity_match=d->>'identity_match',
    ai_reason=CASE WHEN result_status='accepted' AND id<>canonical THEN 'Ismétlődő sor; a kapcsolat kanonikus sora őrzi a döntést.' ELSE d->>'reason' END,
    ai_evidence_phrases=ARRAY(SELECT jsonb_array_elements_text(COALESCE(d->'evidence_phrases','[]'))),
    ai_judged_at=now(),ai_model=w.model_used
  WHERE person_id=_person AND episode_id=_episode;
 END IF;
 GET DIAGNOSTICS changed=ROW_COUNT;
 INSERT INTO ai_call_audit(job_type,provider,model_used,status,estimated_cost_usd,prompt_version,source_hash,target_type,target_id,meta)
 VALUES('person_relevance_apply','internal',COALESCE(w.model_used,'input_guard'),'ok',0,'person-pairs-v1',w.source_hash,
  'person_episode_mention',canonical,jsonb_build_object('person_id',_person,'episode_id',_episode,'decision',d,
  'previous',before_rows,'changed_rows',changed,'protected_manual',COALESCE(protected,false)));
 UPDATE person_relevance_work SET lease_until=now(),updated_at=now() WHERE person_id=_person AND episode_id=_episode;
 RETURN jsonb_build_object('status',result_status,'changed_rows',changed,'canonical_id',canonical);
END;
$$;

-- Atomic telemetry merge cannot resurrect a concurrently paused runner.
CREATE OR REPLACE FUNCTION public.person_judge_telemetry(_patch jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE app_settings SET value=value || (_patch-'enabled'-'daily_budget_usd'-'batch_limit'-'concurrency'-'max_ai_calls_per_run'),updated_at=now()
 WHERE key='person_relevance_judge_controls';
$$;

REVOKE ALL ON FUNCTION public.person_judge_source(uuid,uuid),public.person_judge_run_lease(uuid,boolean),
 public.claim_person_judge_pairs(integer,uuid,uuid[]),public.apply_person_judge_pair(uuid,uuid,uuid),public.person_judge_telemetry(jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.person_judge_source(uuid,uuid),public.person_judge_run_lease(uuid,boolean),
 public.claim_person_judge_pairs(integer,uuid,uuid[]),public.apply_person_judge_pair(uuid,uuid,uuid),public.person_judge_telemetry(jsonb)
 TO service_role;

-- Pilot first. Cadence and existing monetary budgets are deliberately unchanged.
UPDATE app_settings SET value=value || '{"ai_batch_size":6,"bulk_review_version":"person-pairs-v1"}'::jsonb,updated_at=now()
WHERE key='person_relevance_judge_controls';
