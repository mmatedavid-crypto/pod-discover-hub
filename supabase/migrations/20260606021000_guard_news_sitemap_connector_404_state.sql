-- Guard news sitemap state against stale Lovable connector 404 writes.
-- A connector route 404 is operational connector evidence, not a Google
-- Search Console sitemap submit status. Keep the route-missing evidence in a
-- separate key so production verification is not poisoned by transient gateway
-- route availability or an older refresh-sitemap deployment.

CREATE OR REPLACE FUNCTION public.guard_news_sitemap_state_connector_404()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.key = 'news_sitemap_state'
     AND COALESCE(NEW.value->>'google_submit_status', '') = '404' THEN
    NEW.value = NEW.value
      - 'google_submit_status'
      || jsonb_build_object(
        'google_submit_status', NULL,
        'google_submit_reason', COALESCE(NULLIF(NEW.value->>'google_submit_reason', ''), 'lovable_gsc_connector_route_missing_404'),
        'google_submit_method', COALESCE(NULLIF(NEW.value->>'google_submit_method', ''), 'PUT'),
        'connector_route_missing_status', 404,
        'connector_404_guard', 'news_sitemap_state_connector_404_guard_v2'
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_news_sitemap_state_connector_404 ON public.app_settings;
CREATE TRIGGER trg_guard_news_sitemap_state_connector_404
BEFORE INSERT OR UPDATE OF value ON public.app_settings
FOR EACH ROW
WHEN (NEW.key = 'news_sitemap_state')
EXECUTE FUNCTION public.guard_news_sitemap_state_connector_404();

UPDATE public.app_settings
SET value = value
  - 'google_submit_status'
  || jsonb_build_object(
    'google_submit_status', NULL,
    'google_submit_reason', COALESCE(NULLIF(value->>'google_submit_reason', ''), 'lovable_gsc_connector_route_missing_404'),
    'google_submit_method', COALESCE(NULLIF(value->>'google_submit_method', ''), 'PUT'),
    'submit_needed', COALESCE((value->>'submit_needed')::boolean, true),
    'connector_route_missing_status', 404,
    'connector_404_guard', 'news_sitemap_state_connector_404_guard_v2'
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
    'connector_404_policy', 'db_guard_records_route_missing_without_google_submit_status_404',
    'connector_404_guard', 'news_sitemap_state_connector_404_guard_v2',
    'note', 'Refreshes sitemap lite every 15 minutes; refresh-sitemap submits news-sitemap.xml through the Lovable Google Search Console connector with PUT only when newly published news URLs appear. Connector route 404 is tracked separately from Google submit status and guarded at app_settings write time.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  - 'requires_google_secrets'
  || EXCLUDED.value,
    updated_at = now();
