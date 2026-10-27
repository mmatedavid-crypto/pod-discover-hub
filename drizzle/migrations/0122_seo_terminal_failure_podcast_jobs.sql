-- Terminal SEO failures for podcast-level jobs (seo_podcast) used to raise, which left the
-- job in 'processing'; the stale-lock reaper put it back to pending and it was retried
-- (a paid call) every run forever. Both SEO job kinds now finish terminally; the
-- derivation mark still applies only to episodes (the caller passes null for podcasts).
CREATE OR REPLACE FUNCTION public.fail_seo_job_terminal_v1(
  p_job_id uuid, p_last_error text, p_result jsonb DEFAULT NULL, p_mark jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_mark jsonb := NULL; v_kind text;
BEGIN
  IF NOT public.pipeline_catchup_caller_allowed_v1() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.ai_enrichment_jobs
     SET status = 'failed', locked_until = NULL,
         last_error = left(coalesce(p_last_error, 'error'), 1000),
         result = coalesce(p_result, result)
   WHERE id = p_job_id AND kind IN ('seo_episode', 'seo_podcast') AND status <> 'done'
  RETURNING kind INTO v_kind;
  IF NOT FOUND THEN RAISE EXCEPTION 'seo job % not found or already done', p_job_id; END IF;
  IF p_mark IS NOT NULL THEN
    IF v_kind <> 'seo_episode' THEN RAISE EXCEPTION 'derivation mark only applies to episode jobs'; END IF;
    v_mark := public.mark_episode_derivation_v1('seo', jsonb_build_array(p_mark));
  END IF;
  RETURN jsonb_build_object('job', 'failed', 'kind', v_kind, 'mark', v_mark);
END $function$;

REVOKE ALL ON FUNCTION public.fail_seo_job_terminal_v1(uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_seo_job_terminal_v1(uuid, text, jsonb, jsonb) TO service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.fail_seo_job_terminal_v1(uuid, text, jsonb, jsonb) FROM readonly_codex';
  END IF;
END $$;

-- The one podcast job stuck in that loop (attempts beyond the runner's limit) is closed now.
UPDATE public.ai_enrichment_jobs
   SET status = 'failed', locked_until = NULL
 WHERE kind = 'seo_podcast' AND status IN ('pending', 'processing') AND attempts >= 3
   AND last_error LIKE 'hu_language_guard_failed%';