UPDATE app_settings
SET value = jsonb_set(jsonb_set(value, '{batch_size}', '20'::jsonb), '{concurrency}', '2'::jsonb), updated_at=now()
WHERE key='deep_hydration';