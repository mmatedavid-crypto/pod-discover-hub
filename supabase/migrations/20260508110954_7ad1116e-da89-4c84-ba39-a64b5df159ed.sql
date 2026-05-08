
-- 1) Revoke EXECUTE from anon/authenticated/public on admin-only SECURITY DEFINER helpers.
--    Keep has_role broadly executable (used by RLS via auth.uid()).
REVOKE ALL ON FUNCTION public.claim_ai_jobs(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cron_revert_title_cleanup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.embed_candidate_stats(text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ops_dashboard_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.select_embed_candidates(text, text[], integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_embed_schedule(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_incremental_refresh_command(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_rss_self_healing_command(text, boolean, text) FROM PUBLIC, anon, authenticated;

-- 2) Lightweight cron health function, admin-only.
CREATE OR REPLACE FUNCTION public.get_cron_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE
  v_jobs jsonb;
  v_recent jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'jobid', jobid, 'jobname', jobname, 'schedule', schedule, 'active', active
  ) ORDER BY jobid), '[]'::jsonb) INTO v_jobs FROM cron.job;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'jobid', jobid,
    'status', status,
    'start_time', start_time,
    'end_time', end_time,
    'duration_ms', EXTRACT(EPOCH FROM (end_time - start_time)) * 1000,
    'return_message', return_message
  ) ORDER BY start_time DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT * FROM cron.job_run_details
     WHERE start_time > now() - interval '6 hours'
     ORDER BY start_time DESC
     LIMIT 50
  ) t;

  RETURN jsonb_build_object('generated_at', now(), 'jobs', v_jobs, 'recent_runs', v_recent);
END $function$;

REVOKE ALL ON FUNCTION public.get_cron_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_health() TO authenticated;
