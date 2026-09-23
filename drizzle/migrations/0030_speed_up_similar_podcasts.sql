-- Episode counts/recency now read the slim card projection (indexed by podcast_id,
-- published_at) instead of scanning the full episodes table for 40 candidates.
CREATE OR REPLACE FUNCTION public.get_similar_podcasts_by_embedding(p_podcast_id uuid, p_limit integer DEFAULT 8)
 RETURNS TABLE(id uuid, similarity double precision, final_score double precision, title text, display_title text, slug text, summary text, description text, image_url text, category text, apple_url text, spotify_url text, youtube_url text, website_url text, featured boolean, rss_status text, podiverzum_rank numeric, rank_label text, episode_count integer, latest_episode_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '8s'
AS $function$
DECLARE src_embedding vector(768);
BEGIN
  SELECT embedding INTO src_embedding
  FROM podcast_embeddings WHERE podcast_id = p_podcast_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH cand AS (
    SELECT p.*, (1 - (pe.embedding <=> src_embedding))::float AS sim
    FROM podcast_embeddings pe
    JOIN podcasts p ON p.id = pe.podcast_id
    WHERE pe.podcast_id <> p_podcast_id
      AND p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND COALESCE(p.rss_status,'healthy') NOT IN ('failed','inactive')
      AND COALESCE(p.rank_label,'E') IN ('S','A','B','C')
    ORDER BY pe.embedding <=> src_embedding
    LIMIT 40
  ),
  stats AS (
    SELECT c.*, agg.ep_count, agg.last_ep_at
    FROM cand c
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS ep_count, max(ec.published_at) AS last_ep_at
      FROM episode_cards ec WHERE ec.podcast_id = c.id
    ) agg ON true
  )
  SELECT
    s.id, s.sim,
    (
      s.sim
      + CASE s.rank_label WHEN 'S' THEN 0.08 WHEN 'A' THEN 0.05 WHEN 'B' THEN 0.02 ELSE 0 END
      + CASE WHEN s.last_ep_at > now() - interval '60 days' THEN 0.04 ELSE 0 END
      + CASE WHEN s.ep_count >= 20 THEN 0.02 ELSE 0 END
    )::float AS fscore,
    s.title, s.display_title, s.slug, s.summary, s.description,
    s.image_url, s.category, s.apple_url, s.spotify_url, s.youtube_url, s.website_url,
    s.featured, s.rss_status, s.podiverzum_rank, s.rank_label,
    coalesce(s.ep_count, 0), s.last_ep_at
  FROM stats s
  WHERE s.sim >= 0.55
  ORDER BY fscore DESC
  LIMIT GREATEST(p_limit, 1);
END;
$function$;