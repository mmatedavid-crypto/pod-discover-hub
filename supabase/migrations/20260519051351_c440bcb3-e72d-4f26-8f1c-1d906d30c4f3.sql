UPDATE app_settings
SET value = COALESCE(value, '{}'::jsonb) || jsonb_build_object(
  'ranking_version', 2,
  'understanding_version', 2,
  'policy', 'quality_first',
  'policy_updated_at', now()
)
WHERE key = 'search_engine';

UPDATE search_query_cache
SET rerank = NULL, rerank_updated_at = NULL
WHERE rerank IS NOT NULL
  AND (rerank->>'__rv' IS NULL OR (rerank->>'__rv')::int < 2);