-- Reassert only the related-episode policy setting after production drift where
-- v5 functions exist, but app_settings still reports v4.

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
    'same_specific_group_min_similarity_without_bridge', 0.70,
    'general_min_similarity_without_bridge', 0.82,
    'public_affairs_override_terms', jsonb_build_array(
      'orbán', 'mészáros', 'fidesz', 'tisza', 'kormány',
      'parlament', 'párt', 'választás', 'puzsér', 'ner'
    ),
    'bridge_sources', jsonb_build_array('topics', 'people', 'mentioned', 'companies'),
    'known_false_positive_fixed', 'puzser_public_affairs_title_with_isten_must_not_match_sermon',
    'reasserted_by', '20260605214000_reassert_related_quality_policy_v5_settings',
    'note', 'Cross-podcast recommendations need explainable topic/person/company evidence; v5 runtime functions are present and this setting records the matching policy.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
