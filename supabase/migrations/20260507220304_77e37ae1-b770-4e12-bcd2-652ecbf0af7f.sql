CREATE OR REPLACE FUNCTION public.set_embed_schedule(_schedule text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE v_jobid int;
BEGIN
  IF _schedule NOT IN ('* * * * *', '*/2 * * * *', '*/5 * * * *', '*/15 * * * *', '*/30 * * * *') THEN
    RAISE EXCEPTION 'invalid schedule: %', _schedule;
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'podiverzum-embed-podcast-2min';
  IF v_jobid IS NULL THEN
    RAISE EXCEPTION 'embed cron job not found';
  END IF;
  PERFORM cron.alter_job(job_id := v_jobid, schedule := _schedule);
END $function$;