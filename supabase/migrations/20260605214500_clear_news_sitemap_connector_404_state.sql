-- A Lovable connector gateway 404 means the connector route is unavailable,
-- not that the news sitemap is invalid. Keep submit_needed true, but stop
-- poisoning the verifier state with google_submit_status=404.

UPDATE public.app_settings
SET value = value
  || jsonb_build_object(
    'google_submit_status', NULL,
    'google_submit_reason', 'lovable_gsc_connector_route_missing_404',
    'google_submit_method', 'PUT',
    'submit_needed', true,
    'connector_route_missing_status', 404
  ),
  updated_at = now()
WHERE key = 'news_sitemap_state'
  AND value->>'google_submit_status' = '404';

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
    'connector_404_policy', 'record_route_missing_without_google_submit_status_404',
    'note', 'Refreshes sitemap lite every 15 minutes; refresh-sitemap submits news-sitemap.xml through the Lovable Google Search Console connector with PUT only when newly published news URLs appear. Connector route 404 is tracked separately from Google submit status.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  - 'requires_google_secrets'
  || EXCLUDED.value,
    updated_at = now();
