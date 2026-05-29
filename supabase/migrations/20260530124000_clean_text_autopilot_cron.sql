INSERT INTO public.app_settings(key, value)
VALUES (
  'clean_text_autopilot',
  jsonb_build_object(
    'enabled', true,
    'mode', 'bad_or_old',
    'tiers', jsonb_build_array('S', 'A', 'B', 'C'),
    'stage_limit', 250,
    'candidate_batch', 100,
    'promote_limit', 100,
    'ai_enrich_limit', 20,
    'auto_stop_at_errors', 5,
    'consecutive_errors', 0,
    'note', 'Automated clean-text safe refresh: plan, stage, candidate generation, promote changed passed rows only.'
  )
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-clean-text-autopilot-10min'
  ) THEN
    PERFORM cron.schedule(
      'podiverzum-clean-text-autopilot-10min',
      '*/10 * * * *',
      $cmd$
      SELECT net.http_post(
        url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/clean-text-autopilot',
        headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
        body := concat('{"trigger":"cron","ts":"', now(), '"}')::jsonb
      );
      $cmd$
    );
  END IF;
END $$;
