INSERT INTO public.app_settings(key, value)
VALUES (
  'language_cleanup_policy',
  jsonb_build_object(
    'enabled', true,
    'delete_decisions', jsonb_build_array('reject_foreign', 'confirmed_foreign', 'reject_non_hungarian'),
    'dry_run', false,
    'limit_per_run', 500,
    'schedule', '*/15 * * * *',
    'note', 'Podiverzum is HU-only: confirmed foreign podcasts are deleted with audit log, not merely hidden.'
  )
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-language-cleanup-15min'
  ) THEN
    PERFORM cron.schedule(
      'podiverzum-language-cleanup-15min',
      '*/15 * * * *',
      $cmd$
      SELECT net.http_post(
        url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/language-cleanup-runner',
        headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
        body := '{"trigger":"cron","dry_run":false,"limit":500}'::jsonb
      );
      $cmd$
    );
  END IF;
END $$;

SELECT net.http_post(
  url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/language-cleanup-runner',
  headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
  body := '{"trigger":"migration","dry_run":false,"limit":500}'::jsonb
);
