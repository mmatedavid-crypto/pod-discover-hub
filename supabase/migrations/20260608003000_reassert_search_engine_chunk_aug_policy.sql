-- Keep transcript chunk augmentation operator-controlled until chunk quality gates are green in production.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'search_engine',
  jsonb_build_object(
    'default_engine', 'v13',
    'fallback_engine', 'v12',
    'quality_guard_enabled', true,
    'chunk_aug_enabled', false,
    'chunk_aug_policy', 'operator_controlled_after_chunk_quality_verification_v1',
    'chunk_aug_prerequisites', jsonb_build_array(
      'episode_chunking_policy.timestamp_aware_v2',
      'episode_chunk_search_result_policy.timestamp_chunk_search_v3_content_snippet',
      'search_events.timestamp_match_count',
      'search_events.chunk_augmented_count'
    ),
    'ranking_version', 2,
    'understanding_version', 2,
    'reasserted_by', '20260608003000_reassert_search_engine_chunk_aug_policy',
    'note', 'v13 is the default search engine, v12 remains the fallback, and transcript chunk augmentation stays disabled until explicitly enabled after production quality verification.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();
