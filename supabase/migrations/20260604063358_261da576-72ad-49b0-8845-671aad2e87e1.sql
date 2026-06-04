UPDATE public.app_settings
SET value = jsonb_set(COALESCE(value, '{}'::jsonb), '{hash}', '"force_resubmit_20260604"'::jsonb)
WHERE key = 'news_sitemap_state';