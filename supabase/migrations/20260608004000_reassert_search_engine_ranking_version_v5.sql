-- Preserve the current v5 search ranking cache boundary after later search policy reassertions.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'search_engine',
  jsonb_build_object(
    'ranking_version', 5,
    'understanding_version', 2,
    'ranking_policy', 'v13_person_pin_and_natural_question_current_v5',
    'reasserted_by', '20260608004000_reassert_search_engine_ranking_version_v5'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();
