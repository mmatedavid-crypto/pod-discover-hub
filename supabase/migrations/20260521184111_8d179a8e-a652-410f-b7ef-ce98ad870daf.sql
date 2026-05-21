
-- Fix RPC: actual cron jobname is podiverzum-incremental-refresh-hourly
CREATE OR REPLACE FUNCTION public.set_incremental_refresh_schedule(_schedule text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE v_jobid int;
BEGIN
  IF _schedule NOT IN ('*/5 * * * *','*/10 * * * *','*/30 * * * *','0 * * * *') THEN
    RAISE EXCEPTION 'invalid schedule: %', _schedule;
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job
   WHERE jobname IN ('podiverzum-incremental-refresh-hourly','podiverzum-incremental-refresh-10min','podiverzum-incremental-refresh-5min')
   ORDER BY jobid LIMIT 1;
  IF v_jobid IS NULL THEN RAISE EXCEPTION 'incremental refresh cron not found'; END IF;
  PERFORM cron.alter_job(job_id := v_jobid, schedule := _schedule);
END $function$;

-- Immediately bump the cron to */5 since due_count > 500
SELECT cron.alter_job(job_id := 3, schedule := '*/5 * * * *');
