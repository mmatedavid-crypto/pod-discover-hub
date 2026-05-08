CREATE OR REPLACE FUNCTION public.set_incremental_refresh_command(_command text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $$
DECLARE v_jobid int;
BEGIN
  IF _command IS NULL OR length(_command) < 50 THEN
    RAISE EXCEPTION 'invalid command';
  END IF;
  IF position('functions/v1/incremental-refresh' IN _command) = 0 THEN
    RAISE EXCEPTION 'command must target incremental-refresh';
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='podiverzum-incremental-refresh-10min';
  IF v_jobid IS NULL THEN RAISE EXCEPTION 'incremental refresh cron not found'; END IF;
  PERFORM cron.alter_job(job_id := v_jobid, command := _command);
END $$;

REVOKE ALL ON FUNCTION public.set_incremental_refresh_command(text) FROM PUBLIC;