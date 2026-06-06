-- Personalized home seed rails use similar_episodes through service_role.
-- Keep the consumer surface explainable: no "Mert hallgattad" rail item
-- should be emitted unless similar_episodes returned a diagnostic related_reason.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'recommendation_diagnostics_policy',
  jsonb_build_object(
    'version', 2,
    'related_reason_required', true,
    'personalized_home_rails_seed_reason_required', true,
    'personalized_home_rails_seed_source', 'similar_episodes',
    'applies_to', jsonb_build_array('get_related_episodes_by_embedding', 'similar_episodes', 'personalized-home-rails')
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
