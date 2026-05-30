UPDATE public.app_settings
SET value = value
  || jsonb_build_object(
    'dry_run', true,
    'daily_budget_usd', 1.0,
    'note', 'Clean text autopilot starts in full-pipeline dry_run. Set dry_run=false after smoke observation.'
  ),
  updated_at = now()
WHERE key = 'clean_text_autopilot';

UPDATE public.app_settings
SET value = jsonb_set(
  value,
  '{runners}',
  (
    SELECT COALESCE(jsonb_agg(r), '[]'::jsonb)
      || CASE
        WHEN EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(value->'runners', '[]'::jsonb)) existing
          WHERE existing->>'name' = 'clean_text_autopilot'
        )
        THEN '[]'::jsonb
        ELSE jsonb_build_array(
          jsonb_build_object(
            'name', 'clean_text_autopilot',
            'controls_key', 'clean_text_autopilot',
            'progress_key', 'clean_text_autopilot',
            'spend_key', 'clean_text_autopilot_usd',
            'cadence_minutes', 10,
            'min_processed_for_error_rate', 5
          )
        )
      END
    FROM jsonb_array_elements(COALESCE(value->'runners', '[]'::jsonb)) r
  )
)
WHERE key = 'watchdog_state';
