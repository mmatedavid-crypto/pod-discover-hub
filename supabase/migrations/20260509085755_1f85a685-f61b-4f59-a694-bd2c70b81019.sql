UPDATE public.app_settings
SET value = jsonb_set(value, '{batch_size}', '20'::jsonb),
    updated_at = now()
WHERE key = 'deep_hydration';