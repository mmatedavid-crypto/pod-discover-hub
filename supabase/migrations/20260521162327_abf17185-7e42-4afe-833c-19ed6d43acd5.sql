CREATE OR REPLACE FUNCTION public.set_rss_hunter_schedule(_schedule text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
DECLARE v_jobid int;
BEGIN
  IF _schedule NOT IN ('*/30 * * * *','0 */2 * * *','0 */6 * * *','0 6 * * *','0 6 * * 1,4') THEN
    RAISE EXCEPTION 'invalid schedule: %', _schedule;
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='podiverzum-rss-hunter-30min';
  IF v_jobid IS NULL THEN RAISE EXCEPTION 'rss hunter cron not found'; END IF;
  PERFORM cron.alter_job(job_id := v_jobid, schedule := _schedule);
END $function$;