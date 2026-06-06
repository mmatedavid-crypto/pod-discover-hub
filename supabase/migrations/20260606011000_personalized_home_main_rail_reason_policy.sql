-- Personalized-home main rail uses user-history centroid recommendations.
-- Keep the consumer surface explainable and bounded: main rail items must
-- clear a minimum similarity threshold and carry a public Hungarian reason.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'recommendation_diagnostics_policy',
  jsonb_build_object(
    'version', 3,
    'related_reason_required', true,
    'personalized_home_rails_seed_reason_required', true,
    'personalized_home_rails_seed_source', 'similar_episodes',
    'personalized_home_rails_main_reason_required', true,
    'personalized_home_rails_main_source', 'match_episodes_by_user_history',
    'personalized_home_rails_main_min_similarity', 0.18,
    'applies_to', jsonb_build_array('get_related_episodes_by_embedding', 'similar_episodes', 'match_episodes_by_user_history', 'personalized-home-rails')
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
