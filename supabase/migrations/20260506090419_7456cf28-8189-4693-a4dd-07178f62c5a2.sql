-- Enable scheduling extensions for queue auto-drainer
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Seed disabled queue_drainer setting
INSERT INTO public.app_settings (key, value)
VALUES ('queue_drainer', '{"enabled": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;