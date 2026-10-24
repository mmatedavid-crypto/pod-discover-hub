-- Explicit, bounded retry for SEO stages blocked by an exhausted job failure (≤50 episodes per
-- call, live clean-text version only). No automatic retry exists for these; a clean-text change
-- re-opens them through the normal trigger.
CREATE OR REPLACE FUNCTION public.retry_failed_seo_derivations_v1(p_episode_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ids uuid[]; v_jobs int := 0; v_states int := 0;
BEGIN
  IF NOT public.pipeline_catchup_caller_allowed_v1() THEN RAISE EXCEPTION 'not authorized'; END IF;
  v_ids := (coalesce(p_episode_ids, '{}'::uuid[]))[1:50];
  WITH t AS (
    SELECT d.episode_id, d.clean_hash FROM public.episode_derivation_state d
     WHERE d.episode_id = ANY(v_ids) AND d.seo_status = 'blocked'
       AND d.seo_block_reason LIKE 'seo_job_failed:%' AND d.seo_hash = d.clean_hash
     FOR UPDATE),
  j AS (
    UPDATE public.ai_enrichment_jobs a SET status = 'pending', attempts = 0, last_error = NULL, locked_until = NULL
      FROM t WHERE a.kind = 'seo_episode' AND a.target_id = t.episode_id
       AND a.input_hash = 'derivation:clean:' || t.clean_hash AND a.status = 'failed'
    RETURNING a.target_id),
  s AS (
    UPDATE public.episode_derivation_state d SET seo_status = 'queued', seo_block_reason = NULL, last_dispatched_at = now(), updated_at = now()
      FROM t WHERE d.episode_id = t.episode_id AND t.episode_id IN (SELECT target_id FROM j)
    RETURNING d.episode_id)
  SELECT (SELECT count(*) FROM j), (SELECT count(*) FROM s) INTO v_jobs, v_states;
  RETURN jsonb_build_object('requested', cardinality(v_ids), 'jobs_requeued', v_jobs, 'stages_queued', v_states);
END $$;
REVOKE ALL ON FUNCTION public.retry_failed_seo_derivations_v1(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_failed_seo_derivations_v1(uuid[]) TO service_role;