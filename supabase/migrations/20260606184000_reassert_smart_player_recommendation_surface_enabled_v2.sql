-- Smart-player cross-podcast recommendations are now an approved public surface.
-- Keep the release explicit in app_settings while preserving the existing
-- recommendation quality and accepted-Hungarian catalog guards in the RPC/UI.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'smart_player_recommendation_surface_policy',
  jsonb_build_object(
    'version', 2,
    'enabled', true,
    'public_rpc_execute', true,
    'accepted_hungarian_catalog_required', true,
    'consumer_safe_copy_required', true,
    'related_reason_required', true,
    'gated_functions', jsonb_build_array(
      'public.get_related_episodes_by_embedding(uuid, integer, boolean)',
      'public.similar_episodes(uuid, integer)',
      'public.smart_player_discover(uuid, integer)'
    ),
    'release_condition', 'Public smart-player recommendations are approved after related reason guards, accepted-Hungarian filters, and consumer-safe UI copy are in place.',
    'note', 'UI recommendations are enabled; anon/authenticated RPC access is intentionally granted for the guarded public recommendation surface.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

GRANT EXECUTE ON FUNCTION public.get_related_episodes_by_embedding(uuid, integer, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.similar_episodes(uuid, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.smart_player_discover(uuid, integer) TO anon, authenticated, service_role;
