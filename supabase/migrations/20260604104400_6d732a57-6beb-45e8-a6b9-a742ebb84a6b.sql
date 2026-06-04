
CREATE OR REPLACE FUNCTION public.top_episodes_all_time(
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0,
  p_podcast_slug text DEFAULT NULL,
  p_one_per_podcast boolean DEFAULT false
)
RETURNS TABLE (
  episode_id uuid,
  episode_slug text,
  episode_title text,
  episode_image text,
  published_at timestamptz,
  view_count bigint,
  youtube_video_id text,
  podcast_id uuid,
  podcast_slug text,
  podcast_title text,
  podcast_image text,
  rank_label text,
  chart_appearances int,
  popularity_score numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      e.id AS episode_id,
      e.slug AS episode_slug,
      COALESCE(e.display_title, e.title) AS episode_title,
      e.image_url AS episode_image,
      e.published_at,
      eyl.youtube_view_count::bigint AS view_count,
      eyl.youtube_video_id,
      p.id AS podcast_id,
      p.slug AS podcast_slug,
      COALESCE(p.display_title, p.title) AS podcast_title,
      p.image_url AS podcast_image,
      p.rank_label,
      COALESCE((
        SELECT count(*)::int FROM podcast_charts pc
        WHERE pc.podcast_id = p.id AND pc.country = 'hu'
      ), 0) AS chart_appearances,
      (
        ln(GREATEST(eyl.youtube_view_count, 10))::numeric * 10
        + CASE p.rank_label WHEN 'S' THEN 5 WHEN 'A' THEN 3 WHEN 'B' THEN 2 WHEN 'C' THEN 1 ELSE 0 END
        + LEAST(COALESCE((
            SELECT count(*) FROM podcast_charts pc
            WHERE pc.podcast_id = p.id AND pc.country = 'hu'
          ), 0), 20) * 0.4
      )::numeric AS popularity_score,
      ROW_NUMBER() OVER (
        PARTITION BY CASE WHEN p_one_per_podcast THEN p.id ELSE e.id END
        ORDER BY eyl.youtube_view_count DESC NULLS LAST
      ) AS rn_per_pod
    FROM episode_youtube_links eyl
    JOIN episodes e ON e.id = eyl.episode_id
    JOIN podcasts p ON p.id = eyl.podcast_id
    WHERE eyl.status = 'confirmed'
      AND eyl.youtube_view_count IS NOT NULL
      AND eyl.youtube_view_count > 0
      AND p.language ILIKE 'hu%'
      AND COALESCE(p.rss_status, '') NOT IN ('dead','spam','removed')
      AND (p_podcast_slug IS NULL OR p.slug = p_podcast_slug)
  )
  SELECT episode_id, episode_slug, episode_title, episode_image, published_at,
         view_count, youtube_video_id, podcast_id, podcast_slug, podcast_title,
         podcast_image, rank_label, chart_appearances, popularity_score
  FROM base
  WHERE (NOT p_one_per_podcast) OR rn_per_pod = 1
  ORDER BY view_count DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.top_episodes_all_time(int, int, text, boolean) TO anon, authenticated, service_role;
