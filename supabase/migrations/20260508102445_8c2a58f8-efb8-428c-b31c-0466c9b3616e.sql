CREATE OR REPLACE FUNCTION public.set_rss_self_healing_command(_command text, _active boolean DEFAULT true, _schedule text DEFAULT '*/30 * * * *')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE v_jobid int;
BEGIN
  IF _command IS NULL OR length(_command) < 50 THEN
    RAISE EXCEPTION 'invalid command';
  END IF;
  IF position('functions/v1/rss-self-healing' IN _command) = 0 THEN
    RAISE EXCEPTION 'command must target rss-self-healing';
  END IF;
  IF _schedule NOT IN ('*/30 * * * *','0 */2 * * *','0 */6 * * *','0 6 * * *') THEN
    RAISE EXCEPTION 'invalid schedule: %', _schedule;
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='podiverzum-rss-self-healing-30min';
  IF v_jobid IS NULL THEN RAISE EXCEPTION 'rss self-healing cron not found'; END IF;
  PERFORM cron.alter_job(job_id := v_jobid, command := _command, schedule := _schedule, active := _active);
END $function$;