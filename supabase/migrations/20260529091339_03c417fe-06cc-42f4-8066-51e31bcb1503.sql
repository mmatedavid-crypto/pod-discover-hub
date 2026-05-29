UPDATE public.app_settings
SET value = jsonb_set(value, '{method_version}', '"deterministic_v2"')
WHERE key = 'episode_clean_text_controls';