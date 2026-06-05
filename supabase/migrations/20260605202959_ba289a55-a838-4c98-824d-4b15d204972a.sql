-- Same function bodies as 003000 (idempotent CREATE OR REPLACE), update policy marker only.
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
    'public_affairs_override_terms', jsonb_build_array('orbán', 'mészáros', 'fidesz', 'tisza', 'kormány', 'parlament', 'párt', 'választás', 'puzsér', 'ner'),
    'bridge_sources', jsonb_build_array('topics', 'people', 'mentioned', 'companies'),
    'known_false_positive_fixed', 'puzser_public_affairs_title_with_isten_must_not_match_sermon',
    'reasserted_by', '20260605203000_reassert_recommendation_compatibility_v5_content_bridge',
    'note', 'Cross-podcast recommendations need explainable topic/person/company evidence; production drift had v4 active and the content bridge function missing.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();