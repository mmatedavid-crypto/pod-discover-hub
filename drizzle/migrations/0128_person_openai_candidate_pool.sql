-- Batch claims timed out (8s request limit): every claim grouped and sorted all ~210k pending
-- mentions. Eligible pairs are now precomputed hourly into a pool; the claim reads the pool in
-- index order and re-checks every eligibility condition live (claimed pairs get a lease, so an
-- hourly refresh only delays brand-new mentions, which then wait for a 24h batch anyway).
CREATE TABLE IF NOT EXISTS public.person_openai_batch_candidate_pool (
  person_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  is_public_person boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, episode_id)
);
REVOKE ALL ON public.person_openai_batch_candidate_pool FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.person_openai_batch_candidate_pool TO service_role;
ALTER TABLE public.person_openai_batch_candidate_pool ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_person_openai_pool_order ON public.person_openai_batch_candidate_pool
  (is_public_person DESC, published_at DESC NULLS LAST, person_id, episode_id);

CREATE OR REPLACE FUNCTION public.refresh_person_openai_batch_candidate_pool_v1()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET statement_timeout = '180s'
AS $$
DECLARE removed integer; added integer; total integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('person_openai_batch_candidate_pool')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_running');
  END IF;
  DROP TABLE IF EXISTS _pool_new;
  CREATE TEMP TABLE _pool_new ON COMMIT DROP AS
  WITH cand AS (
    SELECT m.person_id, m.episode_id,
      COALESCE(bool_or(person.is_public AND person.is_indexable), false) AS pub, max(e.published_at) AS pub_at
    FROM person_episode_mentions m
    JOIN people person ON person.id = m.person_id
    JOIN episodes e ON e.id = m.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE m.relevance_status = 'pending' AND p.language_decision = 'accept_hungarian'
    GROUP BY m.person_id, m.episode_id
  )
  SELECT c.person_id, c.episode_id, c.pub, c.pub_at FROM cand c
  WHERE NOT EXISTS (
      SELECT 1 FROM person_episode_mentions x WHERE x.person_id = c.person_id AND x.episode_id = c.episode_id
        AND (x.relevance_status IN ('accepted','rejected','in_progress')
          OR COALESCE(x.validation_source, '') ~* 'manual|chatgpt|external_review'))
    AND NOT EXISTS (
      SELECT 1 FROM person_relevance_work w WHERE w.person_id = c.person_id AND w.episode_id = c.episode_id
        AND w.lease_until > now());

  DELETE FROM person_openai_batch_candidate_pool pl
  WHERE NOT EXISTS (SELECT 1 FROM _pool_new n WHERE n.person_id = pl.person_id AND n.episode_id = pl.episode_id);
  GET DIAGNOSTICS removed = ROW_COUNT;
  INSERT INTO person_openai_batch_candidate_pool(person_id, episode_id, is_public_person, published_at, refreshed_at)
  SELECT person_id, episode_id, pub, pub_at, now() FROM _pool_new
  ON CONFLICT (person_id, episode_id) DO UPDATE
    SET is_public_person = EXCLUDED.is_public_person, published_at = EXCLUDED.published_at, refreshed_at = now()
    WHERE person_openai_batch_candidate_pool.is_public_person IS DISTINCT FROM EXCLUDED.is_public_person
       OR person_openai_batch_candidate_pool.published_at IS DISTINCT FROM EXCLUDED.published_at;
  GET DIAGNOSTICS added = ROW_COUNT;
  SELECT count(*) INTO total FROM person_openai_batch_candidate_pool;
  RETURN jsonb_build_object('ok', true, 'removed', removed, 'upserted', added, 'total', total, 'at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_person_openai_batch_candidate_pool_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_person_openai_batch_candidate_pool_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.claim_person_openai_batch_pairs(_job uuid, _limit integer, _role text DEFAULT NULL::text, _person_ids uuid[] DEFAULT NULL::uuid[])
RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.claim_person_openai_batch_pairs(uuid, integer, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_person_openai_batch_pairs(uuid, integer, text, uuid[]) TO service_role;

SELECT public.refresh_person_openai_batch_candidate_pool_v1();

DO $$ BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'person-openai-candidate-pool-refresh';
  PERFORM cron.schedule('person-openai-candidate-pool-refresh', '35 * * * *',
    $cmd$SELECT public.refresh_person_openai_batch_candidate_pool_v1();$cmd$);
END $$;