
DROP FUNCTION IF EXISTS public.match_episodes_by_taste_vector(vector, vector, uuid[], integer);

CREATE OR REPLACE FUNCTION public.match_episodes_by_taste_vector(
  p_user_vector vector,
  p_negative_vector vector DEFAULT NULL::vector,
  p_exclude_episode_ids uuid[] DEFAULT '{}'::uuid[],
  p_limit integer DEFAULT 16
)
RETURNS TABLE(
  episode_id uuid, podcast_id uuid, title text, display_title text, slug text,
  image_url text, ai_summary text, podcast_title text, podcast_slug text,
  podcast_image_url text, published_at timestamp with time zone,
  similarity numeric, final_score numeric,
  topics text[], category text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  has_neg boolean := p_negative_vector IS NOT NULL;
BEGIN
  RETURN QUERY
  WITH scored AS (
    SELECT
      e.id AS episode_id, e.podcast_id, e.title, e.display_title, e.slug,
      e.image_url, e.ai_summary,
      p.title AS podcast_title, p.slug AS podcast_slug, p.image_url AS podcast_image_url,
      e.published_at, e.topics, p.category,
      (1 - (ee.embedding <=> p_user_vector))::numeric AS similarity,
      CASE WHEN has_neg THEN (1 - (ee.embedding <=> p_negative_vector))::numeric ELSE 0::numeric END AS neg_sim,
      CASE p.rank_label WHEN 'S' THEN 0.10 WHEN 'A' THEN 0.06 WHEN 'B' THEN 0.03 WHEN 'C' THEN 0.01 ELSE 0.0 END::numeric AS quality_boost,
      CASE
        WHEN e.published_at IS NULL THEN 0.0
        WHEN e.published_at > now() - interval '14 days' THEN 0.06
        WHEN e.published_at > now() - interval '90 days' THEN 0.03
        ELSE 0.0
      END::numeric AS recency_boost
    FROM public.episode_embeddings ee
    JOIN public.episodes e ON e.id = ee.episode_id
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE p.language ILIKE 'hu%'
      AND (p_exclude_episode_ids IS NULL OR NOT (e.id = ANY(p_exclude_episode_ids)))
    ORDER BY ee.embedding <=> p_user_vector
    LIMIT 400
  ),
  ranked AS (
    SELECT s.*,
      (s.similarity - 0.15 * s.neg_sim + s.quality_boost + s.recency_boost)::numeric AS final_score,
      ROW_NUMBER() OVER (PARTITION BY s.podcast_id
                         ORDER BY (s.similarity - 0.15 * s.neg_sim + s.quality_boost + s.recency_boost) DESC) AS rn
    FROM scored s
  )
  SELECT r.episode_id, r.podcast_id, r.title, r.display_title, r.slug, r.image_url,
         r.ai_summary, r.podcast_title, r.podcast_slug, r.podcast_image_url, r.published_at,
         r.similarity, r.final_score, r.topics, r.category
  FROM ranked r
  WHERE r.rn <= 3
  ORDER BY r.final_score DESC
  LIMIT GREATEST(p_limit, 1);
END;
$function$;
