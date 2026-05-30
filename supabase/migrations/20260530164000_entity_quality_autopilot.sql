INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'entity_quality_controls',
  jsonb_build_object(
    'enabled', true,
    'dry_run', true,
    'snapshot_limit', 100,
    'apply_limit', 100,
    'batch_limit', 100,
    'allowed_apply_actions', jsonb_build_array('hide_low_confidence_organization'),
    'auto_stop_at_errors', 5,
    'consecutive_errors', 0,
    'note', 'Continuous no-AI entity quality autopilot. Starts dry-run; applies only non-destructive hide flags when explicitly enabled.'
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
    WHERE r->>'name' NOT IN ('entity_quality_apply_runner', 'entity_quality_autopilot')
  )
  || jsonb_build_array(
    jsonb_build_object(
      'name', 'entity_quality_apply_runner',
      'controls_key', 'entity_quality_controls',
      'progress_key', 'entity_quality_controls',
      'spend_key', null,
      'cadence_minutes', 0,
      'min_processed_for_error_rate', 1
    ),
    jsonb_build_object(
      'name', 'entity_quality_autopilot',
      'controls_key', 'entity_quality_controls',
      'progress_key', 'entity_quality_controls',
      'spend_key', null,
      'cadence_minutes', 30,
      'min_processed_for_error_rate', 1
    )
  ),
  true
),
updated_at = now()
WHERE key = 'watchdog_state';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-entity-quality-autopilot-30min'
  ) THEN
    PERFORM cron.schedule(
      'podiverzum-entity-quality-autopilot-30min',
      '*/30 * * * *',
      $cmd$
      SELECT net.http_post(
        url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/entity-quality-autopilot',
        headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
        body := concat('{"trigger":"cron","ts":"', now(), '"}')::jsonb
      );
      $cmd$
    );
  END IF;
END $$;
