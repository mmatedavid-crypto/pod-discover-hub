INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'data_repair_controls',
  jsonb_build_object(
    'enabled', true,
    'dry_run', true,
    'batch_limit', 100,
    'allowed_apply_actions', jsonb_build_array('neutralize_legacy_episode_rank'),
    'note', 'No-AI apply runner. Starts dry-run; only legacy episode rank neutralization is supported.'
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
    WHERE r->>'name' <> 'data_repair_apply_runner'
  )
  || jsonb_build_array(
    jsonb_build_object(
      'name', 'data_repair_apply_runner',
      'controls_key', 'data_repair_controls',
      'progress_key', 'data_repair_controls',
      'spend_key', null,
      'cadence_minutes', 0,
      'min_processed_for_error_rate', 1
    )
  ),
  true
),
updated_at = now()
WHERE key = 'watchdog_state';
