-- Person pin in search-hybrid response.
-- Bump ranking cache version so benchmark/UI diagnostics separate this policy
-- from older runs that lacked first-class person-page hits.

UPDATE public.app_settings
SET value = jsonb_set(
  COALESCE(value, '{}'::jsonb),
  '{ranking_version}',
  to_jsonb(GREATEST(COALESCE((value->>'ranking_version')::int, 0), 5)),
  true
)
WHERE key = 'search_engine';

INSERT INTO public.app_settings (key, value)
SELECT 'search_engine', '{"default_engine":"v13","fallback_engine":"v12","quality_guard_enabled":true,"ranking_version":5,"understanding_version":2}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_settings WHERE key = 'search_engine'
);
