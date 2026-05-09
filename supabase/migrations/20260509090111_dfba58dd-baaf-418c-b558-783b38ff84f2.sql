UPDATE app_settings
SET value = jsonb_set(jsonb_set(value, '{batch_size}', '40'::jsonb), '{cron_schedule}', '"*/5 * * * *"'::jsonb),
    updated_at = now()
WHERE key = 'deep_hydration';

SELECT cron.alter_job(7, schedule := '*/5 * * * *');