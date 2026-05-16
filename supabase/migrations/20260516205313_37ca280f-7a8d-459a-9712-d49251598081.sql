CREATE OR REPLACE FUNCTION public.set_seo_enrich_runner_schedule(_schedule text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE v_jobid int;
BEGIN
  IF _schedule NOT IN ('* * * * *','*/2 * * * *','*/5 * * * *','*/10 * * * *','*/30 * * * *') THEN
    RAISE EXCEPTION 'invalid schedule: %', _schedule;
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job
   WHERE jobname IN ('podiverzum-seo-enrich-runner','podiverzum-seo-enrich-runner-5min')
   ORDER BY jobid LIMIT 1;
  IF v_jobid IS NULL THEN RAISE EXCEPTION 'seo enrich runner cron not found'; END IF;
  PERFORM cron.alter_job(job_id := v_jobid, schedule := _schedule);
END $function$;