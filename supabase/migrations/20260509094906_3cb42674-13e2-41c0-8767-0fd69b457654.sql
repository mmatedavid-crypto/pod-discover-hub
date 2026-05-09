CREATE OR REPLACE FUNCTION public.set_seo_enrich_runner_schedule(_schedule text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE v_jobid int;
BEGIN
  IF _schedule NOT IN ('*/2 * * * *','*/5 * * * *','*/10 * * * *','*/30 * * * *') THEN
    RAISE EXCEPTION 'invalid schedule: %', _schedule;
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='podiverzum-seo-enrich-runner-5min';
  IF v_jobid IS NULL THEN RAISE EXCEPTION 'seo enrich runner cron not found'; END IF;
  PERFORM cron.alter_job(job_id := v_jobid, schedule := _schedule);
END $function$;

-- Disable duplicate runner cron (jobid 14) — single adaptive cron (jobid 12) takes over.
DO $$
DECLARE v_jobid int;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='podiverzum-seo-enrich-runner-5min-s20';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_jobid, active := false);
  END IF;
END $$;