-- Smart-player cross-podcast recommendations stay fail-closed until the
-- recommendation quality gates are proven trustworthy in production.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'smart_player_recommendation_surface_policy',
  jsonb_build_object(
    'version', 1,
    'enabled', false,
    'public_rpc_execute', false,
    'quality_gate_required_before_public_enable', true,
    'gated_functions', jsonb_build_array(
      'public.get_related_episodes_by_embedding(uuid, integer, boolean)',
      'public.similar_episodes(uuid, integer)',
      'public.smart_player_discover(uuid, integer)'
    ),
    'release_condition', 'Enable public execution only after related_episode_quality and entity_monitoring_benchmark production verifiers are green and smart-player recommendation UX is explicitly approved.',
    'note', 'UI recommendations are disabled, and anon/authenticated RPC access is revoked so cross-podcast recommendations fail closed at the database boundary.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

REVOKE EXECUTE ON FUNCTION public.get_related_episodes_by_embedding(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.similar_episodes(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.smart_player_discover(uuid, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_related_episodes_by_embedding(uuid, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.similar_episodes(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.smart_player_discover(uuid, integer) TO service_role;
