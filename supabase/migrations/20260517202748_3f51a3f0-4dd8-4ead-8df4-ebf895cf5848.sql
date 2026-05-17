
INSERT INTO public.app_settings (key, value)
VALUES (
  'search_engine',
  jsonb_build_object(
    'default_engine', 'v13',
    'fallback_engine', 'v12',
    'chunk_aug_enabled', false,
    'semantic_enabled', true,
    'cohere_rerank_enabled', true,
    'quality_guard_enabled', true,
    'min_top_score', 0.05
  )
)
ON CONFLICT (key) DO UPDATE
SET value = COALESCE(app_settings.value, '{}'::jsonb) || EXCLUDED.value,
    updated_at = now();
