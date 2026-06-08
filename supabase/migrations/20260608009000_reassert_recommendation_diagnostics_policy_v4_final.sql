-- Keep the cumulative recommendation diagnostics contract after later bundled reassertions.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'recommendation_diagnostics_policy',
  jsonb_build_object(
    'version', 4,
    'related_reason_required', true,
    'related_reason_min_chars', 12,
    'personalized_home_rails_seed_reason_required', true,
    'personalized_home_rails_seed_source', 'similar_episodes',
    'personalized_home_rails_main_reason_required', true,
    'personalized_home_rails_main_source', 'match_episodes_by_user_history',
    'personalized_home_rails_main_min_similarity', 0.18,
    'applies_to', jsonb_build_array(
      'get_related_episodes_by_embedding',
      'similar_episodes',
      'match_episodes_by_user_history',
      'personalized-home-rails'
    ),
    'reason_sources', jsonb_build_array(
      'shared_people',
      'shared_companies',
      'shared_topics',
      'strong_clean_text_embedding_similarity',
      'user_history_centroid'
    ),
    'public_surface_locked_until_quality_trusted', true,
    'smart_player_public_enable_requires', jsonb_build_array(
      'related_episode_quality_green',
      'entity_monitoring_benchmark_green',
      'smart_player_recommendation_surface_explicit_approval'
    ),
    'reasserted_by', '20260608009000_reassert_recommendation_diagnostics_policy_v4_final'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();
