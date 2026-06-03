-- Smart player / related episode hard guard:
-- religious content must never be bridged to non-religious content by vector
-- score alone. Titles like "Isten, Orbán..." can be public-affairs content;
-- without this guard the vector layer may recommend sermons or worship shows.

CREATE OR REPLACE FUNCTION public.recommendation_is_compatible(
  p_source_group text,
  p_candidate_group text,
  p_similarity double precision,
  p_has_topic_bridge boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN (p_source_group = 'religion') <> (p_candidate_group = 'religion') THEN false
    WHEN p_candidate_group = 'children' AND p_source_group <> 'children' THEN false
    WHEN p_source_group = 'children' AND p_candidate_group <> 'children' AND NOT p_has_topic_bridge THEN false
    WHEN p_source_group <> 'general' AND p_candidate_group <> 'general' AND p_source_group <> p_candidate_group
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.72
    WHEN p_source_group <> 'general' AND p_candidate_group = 'general'
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.66
    WHEN p_candidate_group <> 'general' AND p_source_group = 'general'
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.66
    ELSE p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.56 OR p_source_group = p_candidate_group
  END;
$function$;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'related_episode_quality_policy',
  jsonb_build_object(
    'version', 2,
    'religion_cross_group', 'hard_block',
    'children_cross_group', 'hard_block_except_children_source_with_explicit_bridge',
    'note', 'Smart player and related episode recommendations block religion/non-religion vector false positives.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
