INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'weekly_editorial_controls',
  jsonb_build_object(
    'enabled', true,
    'policy', 'weekly_editorial_v2_hu_non_spam_diverse',
    'cadence', 'weekly_monday_morning',
    'min_text_chars', 180,
    'max_candidates', 500,
    'allow_reuse_existing_week', true,
    'model', 'google/gemini-2.5-flash',
    'note', 'Weekly human-reviewed editorial draft. Reuses an existing draft/published post for the same week unless force=true, so AI is not billed repeatedly.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

UPDATE public.app_settings
SET value = jsonb_set(
  value,
  '{runners}',
  (
    SELECT COALESCE(jsonb_agg(r), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(value->'runners', '[]'::jsonb)) r
    WHERE r->>'name' <> 'weekly_editorial_post'
  )
  || jsonb_build_array(
    jsonb_build_object(
      'name', 'weekly_editorial_post',
      'controls_key', 'weekly_editorial_controls',
      'progress_key', null,
      'spend_key', null,
      'cadence_minutes', 10080,
      'min_processed_for_error_rate', 1
    )
  ),
  true
),
updated_at = now()
WHERE key = 'watchdog_state';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-weekly-editorial-post') THEN
    PERFORM cron.unschedule('podiverzum-weekly-editorial-post');
  END IF;

  PERFORM cron.schedule(
    'podiverzum-weekly-editorial-post',
    '30 6 * * 1',
    $cmd$
    SELECT net.http_post(
      url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/weekly-editorial-post',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
      body := concat('{"trigger":"weekly_cron","ts":"', now(), '"}')::jsonb
    );
    $cmd$
  );
END $$;
