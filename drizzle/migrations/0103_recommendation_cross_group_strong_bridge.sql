-- Crossing editorial worlds (different groups, or specific <-> general) now needs a strong
-- bridge everywhere: a verified person, a shared organisation, or >=2 shared topics.
-- A single generic tag ("kockázatok", "kvantumfizika") linked unrelated episodes.
CREATE OR REPLACE FUNCTION public.recommendation_is_compatible_v2(
  p_source_group text, p_candidate_group text, p_similarity double precision,
  p_shared_topics integer, p_entity_bridge boolean)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  WITH x AS (
    SELECT coalesce(p_source_group,'general') AS s, coalesce(p_candidate_group,'general') AS c,
           coalesce(p_similarity,0) AS sim,
           (coalesce(p_entity_bridge,false) OR coalesce(p_shared_topics,0) > 0) AS bridge,
           (coalesce(p_entity_bridge,false) OR coalesce(p_shared_topics,0) >= 2) AS strong
  )
  SELECT CASE
    WHEN (s='religion') <> (c='religion') THEN false
    WHEN c='children' AND s<>'children' THEN false
    WHEN s='children' AND c<>'children' THEN strong
    WHEN s='science' AND c IN ('esoteric','true_crime','self_help') THEN false
    WHEN c='science' AND s IN ('esoteric','true_crime') THEN false
    WHEN s<>c AND (s='science' OR c='science') AND (s='general' OR c='general') THEN strong OR sim >= 0.87
    WHEN s<>c THEN strong
    WHEN s<>'general' THEN bridge OR sim >= 0.70
    ELSE bridge OR sim >= 0.82
  END FROM x;
$function$;
REVOKE ALL ON FUNCTION public.recommendation_is_compatible_v2(text, text, double precision, integer, boolean) FROM PUBLIC, anon, authenticated;
