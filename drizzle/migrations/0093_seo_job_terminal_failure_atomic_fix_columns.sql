CREATE OR REPLACE FUNCTION public.fail_seo_job_terminal_v1(
  p_job_id uuid, p_last_error text, p_result jsonb DEFAULT NULL, p_mark jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_mark jsonb := NULL;
BEGIN
  UPDATE public.ai_enrichment_jobs
     SET status = 'failed', locked_until = NULL,
         last_error = left(coalesce(p_last_error, 'error'), 1000),
         result = coalesce(p_result, result)
   WHERE id = p_job_id AND kind = 'seo_episode' AND status <> 'done';
  IF NOT FOUND THEN RAISE EXCEPTION 'seo job % not found or already done', p_job_id; END IF;
  IF p_mark IS NOT NULL THEN
    v_mark := public.mark_episode_derivation_v1('seo', jsonb_build_array(p_mark));
  END IF;
  RETURN jsonb_build_object('job', 'failed', 'mark', v_mark);
END $function$;

REVOKE ALL ON FUNCTION public.fail_seo_job_terminal_v1(uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_seo_job_terminal_v1(uuid, text, jsonb, jsonb) TO service_role;