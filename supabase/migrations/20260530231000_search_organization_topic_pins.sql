-- First-class organization/topic pins in search, plus high-value Hungarian
-- market aliases that users naturally type.

WITH telekom AS (
  SELECT id
  FROM public.organizations
  WHERE slug IN ('magyar-telekom', 'magyar-telekom-nyrt')
     OR normalized_name = 'magyar telekom'
  ORDER BY gated_episode_count DESC NULLS LAST, episode_count DESC NULLS LAST
  LIMIT 1
)
INSERT INTO public.organization_aliases (organization_id, alias, normalized_alias, source, confidence, status)
SELECT telekom.id, v.alias, v.normalized_alias, 'search_policy_seed_20260530', 0.98, 'accepted'
FROM telekom
CROSS JOIN (VALUES
  ('MTEL', 'mtel'),
  ('MTELEKOM', 'mtelekom'),
  ('Telekom', 'telekom'),
  ('Magyar Telekom Nyrt', 'magyar telekom nyrt'),
  ('Magyar Telekom Nyrt.', 'magyar telekom nyrt')
) AS v(alias, normalized_alias)
ON CONFLICT (normalized_alias) DO UPDATE
SET organization_id = EXCLUDED.organization_id,
    alias = EXCLUDED.alias,
    source = EXCLUDED.source,
    confidence = GREATEST(public.organization_aliases.confidence, EXCLUDED.confidence),
    status = 'accepted';

UPDATE public.app_settings
SET value = jsonb_set(
  COALESCE(value, '{}'::jsonb),
  '{ranking_version}',
  to_jsonb(GREATEST(COALESCE((value->>'ranking_version')::int, 0), 6)),
  true
)
WHERE key = 'search_engine';

INSERT INTO public.app_settings (key, value)
SELECT 'search_engine', '{"default_engine":"v13","fallback_engine":"v12","quality_guard_enabled":true,"ranking_version":6,"understanding_version":2}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_settings WHERE key = 'search_engine'
);
