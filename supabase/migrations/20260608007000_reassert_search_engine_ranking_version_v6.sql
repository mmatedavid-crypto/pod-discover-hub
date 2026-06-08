-- Preserve the current v6 search ranking cache boundary after later search policy reassertions.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'search_engine',
  jsonb_build_object(
    'ranking_version', 6,
    'understanding_version', 2,
    'ranking_policy', 'v13_person_pin_natural_question_organization_topic_current_v6',
    'reasserted_by', '20260608007000_reassert_search_engine_ranking_version_v6'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();
