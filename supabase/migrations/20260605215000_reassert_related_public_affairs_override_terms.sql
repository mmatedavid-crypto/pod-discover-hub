-- Production drift can leave the v5 related-episode policy present but without
-- the public-affairs override terms used by recommendation_text_group.
-- Merge the missing keys without weakening the already-deployed v5 runtime.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'related_episode_quality_policy',
  jsonb_build_object(
    'version', 5,
    'religion_cross_group', 'hard_block',
    'children_cross_group', 'hard_block_except_children_source_with_explicit_bridge',
    'different_specific_groups', 'explicit_bridge_required',
    'specific_to_general', 'explicit_bridge_required',
    'general_to_specific', 'explicit_bridge_required',
    'public_affairs_override_terms', jsonb_build_array(
      'orbán', 'mészáros', 'fidesz', 'tisza', 'kormány',
      'parlament', 'párt', 'választás', 'puzsér', 'ner'
    ),
    'public_affairs_override_terms_reasserted_by', '20260605215000_reassert_related_public_affairs_override_terms'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'version', GREATEST(COALESCE((public.app_settings.value->>'version')::int, 0), 5),
    'religion_cross_group', COALESCE(public.app_settings.value->>'religion_cross_group', 'hard_block'),
    'children_cross_group', COALESCE(public.app_settings.value->>'children_cross_group', 'hard_block_except_children_source_with_explicit_bridge'),
    'different_specific_groups', COALESCE(public.app_settings.value->>'different_specific_groups', 'explicit_bridge_required'),
    'specific_to_general', COALESCE(public.app_settings.value->>'specific_to_general', 'explicit_bridge_required'),
    'general_to_specific', COALESCE(public.app_settings.value->>'general_to_specific', 'explicit_bridge_required'),
    'public_affairs_override_terms', jsonb_build_array(
      'orbán', 'mészáros', 'fidesz', 'tisza', 'kormány',
      'parlament', 'párt', 'választás', 'puzsér', 'ner'
    ),
    'public_affairs_override_terms_reasserted_by', '20260605215000_reassert_related_public_affairs_override_terms'
  ),
  updated_at = now();
