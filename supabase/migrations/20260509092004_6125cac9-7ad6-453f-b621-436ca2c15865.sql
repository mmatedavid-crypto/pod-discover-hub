UPDATE app_settings
SET value = jsonb_set(value, '{concurrency}', '4'::jsonb), updated_at = now()
WHERE key='deep_hydration';