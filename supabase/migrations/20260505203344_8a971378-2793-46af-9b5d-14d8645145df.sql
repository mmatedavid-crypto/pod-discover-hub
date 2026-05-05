
INSERT INTO public.app_settings (key, value) VALUES
  ('ai_controls', jsonb_build_object(
    'enabled', true,
    'max_per_day', 100,
    'max_per_podcast_per_click', 15
  ))
ON CONFLICT (key) DO NOTHING;
