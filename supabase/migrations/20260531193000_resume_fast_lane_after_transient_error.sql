UPDATE public.app_settings
SET value = value
  || jsonb_build_object(
    'enabled', true,
    'consecutive_errors', 0,
    'last_hard_errors', '[]'::jsonb,
    'note', 'Focused deterministic drain: transient worker 502/503/504/546 errors do not auto-pause the lane.'
  ),
  updated_at = now()
WHERE key = 'database_quality_fast_lane';
