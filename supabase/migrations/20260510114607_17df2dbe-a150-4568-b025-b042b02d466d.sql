-- Adaptive scheduling RPC for pi-dump-process
CREATE OR REPLACE FUNCTION public.set_pi_dump_process_schedule(pending_count integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  desired text;
  current_sched text;
  jid bigint;
BEGIN
  -- Choose schedule based on backlog
  IF pending_count > 500 THEN
    desired := '* * * * *';
  ELSIF pending_count >= 100 THEN
    desired := '*/2 * * * *';
  ELSIF pending_count >= 10 THEN
    desired := '*/10 * * * *';
  ELSE
    desired := '*/30 * * * *';
  END IF;

  -- Allowlist guard
  IF desired NOT IN ('* * * * *','*/2 * * * *','*/10 * * * *','*/30 * * * *') THEN
    RAISE EXCEPTION 'invalid schedule %', desired;
  END IF;

  SELECT jobid, schedule INTO jid, current_sched
  FROM cron.job WHERE jobname = 'podiverzum-pi-dump-process-adaptive';

  IF jid IS NULL THEN
    RETURN 'no_job';
  END IF;

  IF current_sched = desired THEN
    RETURN desired;
  END IF;

  PERFORM cron.alter_job(job_id := jid, schedule := desired);
  RETURN desired;
END;
$$;

REVOKE ALL ON FUNCTION public.set_pi_dump_process_schedule(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_pi_dump_process_schedule(integer) TO service_role;

-- Create the cron job (start at every-minute; adaptive RPC will tune it)
SELECT cron.schedule(
  'podiverzum-pi-dump-process-adaptive',
  '* * * * *',
  $job$
    SELECT net.http_post(
      url := 'https://iqzkayoqqagowvxeaphe.supabase.co/functions/v1/pi-dump-process',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxemtheW9xcWFnb3d2eGVhcGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDA3NzAsImV4cCI6MjA5MzU3Njc3MH0.KaeRcYcljGjrP_OAcTp_lapPSRsAYRq6gPJ2vYV7fz4","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxemtheW9xcWFnb3d2eGVhcGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDA3NzAsImV4cCI6MjA5MzU3Njc3MH0.KaeRcYcljGjrP_OAcTp_lapPSRsAYRq6gPJ2vYV7fz4"}'::jsonb,
      body := '{"trigger":"cron","foundation":true,"batch":150}'::jsonb,
      timeout_milliseconds := 115000
    );
  $job$
);