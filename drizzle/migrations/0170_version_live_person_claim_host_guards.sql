CREATE OR REPLACE FUNCTION public.claim_person_judge_pairs(_limit integer, _token uuid, _person_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '15s'
AS $function$
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
  IF EXISTS (SELECT 1 FROM public.person_host_rule_resolutions hr JOIN public.person_host_rules h ON h.id=hr.rule_id WHERE hr.person_id=r.person_id AND hr.episode_id=r.episode_id AND h.active) THEN CONTINUE; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.claim_person_openai_batch_pairs(_job uuid, _limit integer, _role text DEFAULT NULL::text, _person_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE ctrl jsonb; r record; src jsonb; hash text; got integer; lim integer;
BEGIN
  SELECT value INTO ctrl FROM app_settings WHERE key = 'person_relevance_openai_batch_controls';
  IF COALESCE((ctrl->>'enabled')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'batch_controls_disabled'; END IF;
  IF EXISTS (SELECT 1 FROM app_settings WHERE key = 'background_jobs'
    AND (value->>'enabled' = 'false' OR value->>'incident_mode' = 'true')) THEN RAISE EXCEPTION 'background_jobs_paused'; END IF;
  IF NOT EXISTS (SELECT 1 FROM person_relevance_batch_jobs WHERE id = _job AND status = 'claimed') THEN
    RAISE EXCEPTION 'job_not_claimable'; END IF;
  lim := LEAST(GREATEST(_limit, 1), COALESCE((ctrl->>'max_requests_per_job')::integer, 0), 2000);

  FOR r IN
    (
    -- Scheduled runner path: precomputed pool in index order, every condition re-checked live.
    SELECT c.person_id, c.episode_id,
      COALESCE(person.identity_ambiguous, false) OR EXISTS (
        SELECT 1 FROM people other WHERE other.normalized_name = person.normalized_name
          AND other.id <> person.id AND other.is_public) AS identity_risk
    FROM person_openai_batch_candidate_pool c
    JOIN people person ON person.id = c.person_id
    WHERE _role IS NULL AND _person_ids IS NULL
      AND EXISTS (SELECT 1 FROM person_episode_mentions m JOIN episodes e ON e.id = m.episode_id
        JOIN podcasts p ON p.id = e.podcast_id
        WHERE m.person_id = c.person_id AND m.episode_id = c.episode_id
          AND m.relevance_status = 'pending' AND p.language_decision = 'accept_hungarian')
      AND NOT EXISTS (SELECT 1 FROM person_episode_mentions x WHERE x.person_id = c.person_id AND x.episode_id = c.episode_id
        AND (x.relevance_status IN ('accepted','rejected','in_progress')
          OR COALESCE(x.validation_source, '') ~* 'manual|chatgpt|external_review'))
      AND NOT EXISTS (SELECT 1 FROM person_relevance_work w WHERE w.person_id = c.person_id AND w.episode_id = c.episode_id
        AND w.lease_until > now())
    ORDER BY c.is_public_person DESC, c.published_at DESC NULLS LAST, c.person_id, c.episode_id
    LIMIT lim
    )
    UNION ALL
    (
    -- Filtered manual path keeps the original live candidate query.
    SELECT f.person_id, f.episode_id, f.identity_risk
    FROM public.person_openai_batch_candidates(lim, 0, _role, _person_ids) f
    WHERE NOT (_role IS NULL AND _person_ids IS NULL)
    )
  LOOP
    IF EXISTS (SELECT 1 FROM public.person_host_rule_resolutions hr JOIN public.person_host_rules h ON h.id=hr.rule_id WHERE hr.person_id=r.person_id AND hr.episode_id=r.episode_id AND h.active) THEN CONTINUE; END IF;
    src := public.person_judge_source(r.person_id, r.episode_id);
    IF src IS NULL THEN CONTINUE; END IF;
    hash := md5(src::text);
    INSERT INTO person_relevance_work(person_id, episode_id, claim_token, lease_until, source_hash)
    VALUES (r.person_id, r.episode_id, _job, now() + interval '26 hours', hash)
    ON CONFLICT (person_id, episode_id) DO UPDATE SET claim_token = EXCLUDED.claim_token,
      lease_until = EXCLUDED.lease_until, source_hash = EXCLUDED.source_hash, updated_at = now()
    WHERE person_relevance_work.lease_until < now();
    GET DIAGNOSTICS got = ROW_COUNT;
    IF got = 1 THEN
      RETURN NEXT jsonb_build_object('person_id', r.person_id, 'episode_id', r.episode_id, 'source_hash', hash,
        'identity_risk', r.identity_risk, 'input', src);
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_person_openai_escalation_pairs(_job uuid, _limit integer)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE ctrl jsonb; r record; src jsonb; hash text; got integer;
BEGIN
  SELECT value INTO ctrl FROM app_settings WHERE key = 'person_relevance_openai_batch_controls';
  IF COALESCE((ctrl->>'enabled')::boolean, false) IS NOT TRUE OR COALESCE((ctrl->>'escalation_enabled')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'escalation_disabled'; END IF;
  IF EXISTS (SELECT 1 FROM app_settings WHERE key = 'background_jobs'
    AND (value->>'enabled' = 'false' OR value->>'incident_mode' = 'true')) THEN RAISE EXCEPTION 'background_jobs_paused'; END IF;
  IF NOT EXISTS (SELECT 1 FROM person_relevance_batch_jobs WHERE id = _job AND status = 'claimed' AND tier = 'escalation') THEN
    RAISE EXCEPTION 'job_not_claimable'; END IF;
  FOR r IN
    WITH latest AS (
      SELECT DISTINCT ON (i.person_id, i.episode_id) i.id, i.person_id, i.episode_id, i.identity_risk,
        i.decision, i.final_status, i.created_at
      FROM person_relevance_batch_items i
      WHERE i.tier = 'primary' AND i.status = 'applied'
      ORDER BY i.person_id, i.episode_id, i.applied_at DESC NULLS LAST, i.created_at DESC
    ), cand AS (
      SELECT l.*, CASE WHEN l.decision->>'ai_suggested_status' = 'rejected'
          AND l.decision->>'identity_match' IN ('different_person_same_name','substring_false_positive') THEN 2 ELSE 1 END AS prio
      FROM latest l WHERE l.final_status = 'needs_review'
    )
    SELECT c.* FROM cand c
    WHERE NOT (c.identity_risk AND c.prio = 1)
      AND NOT EXISTS (SELECT 1 FROM person_relevance_batch_items e WHERE e.tier = 'escalation'
        AND e.person_id = c.person_id AND e.episode_id = c.episode_id AND e.status <> 'released')
      AND EXISTS (SELECT 1 FROM person_episode_mentions m WHERE m.person_id = c.person_id AND m.episode_id = c.episode_id
        AND m.relevance_status = 'needs_review' AND m.validation_source = 'person_openai_batch_v1')
      AND NOT EXISTS (SELECT 1 FROM person_episode_mentions x WHERE x.person_id = c.person_id AND x.episode_id = c.episode_id
        AND (x.relevance_status IN ('accepted','rejected','in_progress') OR COALESCE(x.validation_source,'') ~* 'manual|chatgpt|external_review'))
      -- Both reviews must read the same episode text.
      AND NOT EXISTS (SELECT 1 FROM episode_clean_text t WHERE t.episode_id = c.episode_id
        AND t.cleaner_method LIKE 'deterministic_v4%' AND COALESCE(t.updated_at, t.created_at) > c.created_at)
      AND NOT EXISTS (SELECT 1 FROM person_relevance_work w WHERE w.person_id = c.person_id AND w.episode_id = c.episode_id AND w.lease_until > now())
    ORDER BY c.prio, c.id
    LIMIT LEAST(GREATEST(COALESCE(_limit, 1), 1), 2000)
  LOOP
    IF EXISTS (SELECT 1 FROM public.person_host_rule_resolutions hr JOIN public.person_host_rules h ON h.id=hr.rule_id WHERE hr.person_id=r.person_id AND hr.episode_id=r.episode_id AND h.active) THEN CONTINUE; END IF;
    src := public.person_judge_source(r.person_id, r.episode_id);
    IF src IS NULL THEN CONTINUE; END IF;
    hash := md5(src::text);
    INSERT INTO person_relevance_work(person_id, episode_id, claim_token, lease_until, source_hash)
    VALUES (r.person_id, r.episode_id, _job, now() + interval '26 hours', hash)
    ON CONFLICT (person_id, episode_id) DO UPDATE SET claim_token = EXCLUDED.claim_token,
      lease_until = EXCLUDED.lease_until, source_hash = EXCLUDED.source_hash, updated_at = now()
    WHERE person_relevance_work.lease_until < now();
    GET DIAGNOSTICS got = ROW_COUNT;
    IF got = 1 THEN
      RETURN NEXT jsonb_build_object('person_id', r.person_id, 'episode_id', r.episode_id, 'source_hash', hash,
        'identity_risk', r.identity_risk, 'input', src, 'prior_item_id', r.id);
    END IF;
  END LOOP;
END;
$function$;