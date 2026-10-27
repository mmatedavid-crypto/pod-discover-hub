-- 1) The attempt counter also numbers never-billed (released) requests for custom_id
--    uniqueness; billed retries are limited separately by max_attempts. 1..5 blocked
--    whole batches once a pair had been released several times.
ALTER TABLE public.person_relevance_batch_items DROP CONSTRAINT IF EXISTS person_relevance_batch_items_attempt_check;
ALTER TABLE public.person_relevance_batch_items ADD CONSTRAINT person_relevance_batch_items_attempt_check CHECK (attempt BETWEEN 1 AND 100);

-- 2) The primary source hash includes the mention review fields that the primary apply
--    itself changes, so it can never match afterwards. The escalation instead requires that
--    the episode's clean text has not changed since the primary review, and records the
--    current source hash (re-checked again at apply time).
CREATE OR REPLACE FUNCTION public.claim_person_openai_escalation_pairs(_job uuid, _limit integer)
RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.claim_person_openai_escalation_pairs(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_person_openai_escalation_pairs(uuid, integer) TO service_role;