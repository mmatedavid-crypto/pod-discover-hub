INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'public_quality_badge_policy',
  jsonb_build_object(
    'version', 1,
    'show_numeric_public_badge', false,
    'reason', 'Hide numeric podcast quality until HU_v2 live ranking and market/source matching are continuously fresh.',
    'replacement', 'Use rank internally for ordering only; public badge can return after weekly calibration.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'hu_formula_v2_controls',
  jsonb_build_object(
    'enabled', true,
    'apply_live', true,
    'min_live_confidence', 0.55,
    'allow_chart_stale_live', false,
    'limit', 1200,
    'only_unscored', false,
    'note', 'HU_v2 is now allowed to refresh live public rank when confidence is acceptable. Rank remains ordering only, not an admission gate.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-hu-formula-v2-live-4h'
  ) THEN
    PERFORM cron.schedule(
      'podiverzum-hu-formula-v2-live-4h',
      '17 */4 * * *',
      $cmd$
      SELECT net.http_post(
        url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/hu-formula-v2-shadow',
        headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
        body := concat('{"trigger":"cron","limit":1200,"only_unscored":false,"apply_live":true,"ts":"', now(), '"}')::jsonb
      );
      $cmd$
    );
  ELSE
    PERFORM cron.alter_job(
      job_id := (SELECT jobid FROM cron.job WHERE jobname = 'podiverzum-hu-formula-v2-live-4h'),
      schedule := '17 */4 * * *',
      active := true
    );
  END IF;
END $$;

UPDATE public.app_settings
SET value = jsonb_set(
  value,
  '{runners}',
  (
    SELECT COALESCE(jsonb_agg(r), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(value->'runners', '[]'::jsonb)) r
    WHERE r->>'name' <> 'hu_formula_v2_live'
  )
  || jsonb_build_array(
    jsonb_build_object(
      'name', 'hu_formula_v2_live',
      'controls_key', 'hu_formula_v2_controls',
      'progress_key', 'hu_formula_v2_runner',
      'cadence_minutes', 240,
      'min_processed_for_error_rate', 20
    )
  ),
  true
),
updated_at = now()
WHERE key = 'watchdog_state';
