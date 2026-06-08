-- Preserve the current v4 search understanding cache boundary after later search policy reassertions.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'search_engine',
  jsonb_build_object(
    'understanding_version', 4,
    'understanding_policy', 'anchor_first_catalog_resolution_current_v4',
    'reasserted_by', '20260608008000_reassert_search_engine_understanding_version_v4'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();
