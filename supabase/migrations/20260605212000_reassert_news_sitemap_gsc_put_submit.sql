-- Google Search Console sitemap submit uses PUT. Clear stale connector 404
-- state caused by the older POST submit attempt, while preserving the fact
-- that a resubmit is still needed when fresh news URLs exist.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'news_sitemap_refresh_controls',
  jsonb_build_object(
    'enabled', true,
    'cadence_minutes', 15,
    'mode', 'refresh_sitemap_lite',
    'google_submit_policy', 'submit_only_when_news_sitemap_has_new_urls',
    'submit_transport', 'lovable_google_search_console_connector_gateway',
    'submit_method', 'PUT',
    'site_url', 'https://podiverzum.hu/',
    'requires_connector_secrets', jsonb_build_array(
      'LOVABLE_API_KEY',
      'GOOGLE_SEARCH_CONSOLE_API_KEY'
    ),
    'note', 'Refreshes sitemap lite every 15 minutes; refresh-sitemap submits news-sitemap.xml through the Lovable Google Search Console connector with PUT only when newly published news URLs appear.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  - 'requires_google_secrets'
  || EXCLUDED.value,
    updated_at = now();

UPDATE public.app_settings
SET value = value
  || jsonb_build_object(
    'google_submit_status', NULL,
    'google_submit_reason', 'stale_lovable_gsc_submit_404_cleared_after_put_method_fix',
    'google_submit_method', 'PUT',
    'submit_needed', COALESCE((value->>'new_url_count')::int, 0) > 0
  ),
  updated_at = now()
WHERE key = 'news_sitemap_state'
  AND value->>'google_submit_status' = '404';
