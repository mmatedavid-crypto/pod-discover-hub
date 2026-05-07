CREATE OR REPLACE FUNCTION public.cron_revert_title_cleanup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE v_jobid int;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'podiverzum-title-cleanup-6h';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '17 */6 * * *');
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.cron_revert_title_cleanup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cron_revert_title_cleanup() TO service_role;