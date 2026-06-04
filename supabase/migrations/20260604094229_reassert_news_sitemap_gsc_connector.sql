-- Reassert news sitemap Google Search Console submit through the Lovable
-- connector gateway. The public site should submit only when fresh news URLs
-- appear, and it must not require service-account JSON secrets.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'news_sitemap_refresh_controls',
  jsonb_build_object(
    'enabled', true,
    'cadence_minutes', 15,
    'mode', 'refresh_sitemap_lite',
    'google_submit_policy', 'submit_only_when_news_sitemap_has_new_urls',
    'submit_transport', 'lovable_google_search_console_connector_gateway',
    'site_url', 'https://podiverzum.hu/',
    'requires_connector_secrets', jsonb_build_array(
      'LOVABLE_API_KEY',
      'GOOGLE_SEARCH_CONSOLE_API_KEY'
    ),
    'note', 'Refreshes sitemap lite every 15 minutes; refresh-sitemap submits news-sitemap.xml through the Lovable Google Search Console connector only when newly published news URLs appear.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  - 'requires_google_secrets'
  || EXCLUDED.value,
    updated_at = now();
