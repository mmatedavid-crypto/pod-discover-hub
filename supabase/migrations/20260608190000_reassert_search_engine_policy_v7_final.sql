-- Final search engine policy lock after telemetry refresh migrations.
-- Keeps v13/v12 engine boundaries, disables transcript chunk augmentation by
-- default, and preserves the current ranking/understanding cache versions.

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
    'ranking_version', 6,
    'ranking_policy', 'v13_person_pin_natural_question_organization_topic_current_v6',
    'understanding_version', 4,
    'understanding_policy', 'anchor_first_catalog_resolution_current_v4',
    'reasserted_by', '20260608190000_reassert_search_engine_policy_v7_final',
    'note', 'Search v13 remains default with v12 fallback; chunk augmentation remains operator-controlled until production quality gates are trusted.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();
