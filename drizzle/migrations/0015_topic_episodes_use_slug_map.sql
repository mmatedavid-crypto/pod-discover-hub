-- Topic list now reads the normalised slug map instead of scanning the wide jsonb.
DROP FUNCTION IF EXISTS public.topic_episodes(uuid, text, integer);
CREATE FUNCTION public.topic_episodes(_topic_id uuid, _slug text DEFAULT NULL, _limit integer DEFAULT 150)
RETURNS TABLE (
  id uuid, title text, display_title text, slug text, image_url text,
  published_at timestamptz, ai_summary text, audio_url text,
  people text[], mentioned text[], topics text[], companies text[], tickers text[],
  podcast_id uuid, podcast_slug text, podcast_title text, podcast_display_title text,
  podcast_image_url text, podcast_category text, podcast_rank numeric,
  podcast_rank_label text, podcast_rss_status text, podcast_featured boolean,
  source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '12s'
AS $$
  WITH candidates AS (
    SELECT episode_id, 0 AS pref FROM episode_topic_relevance_reviews
      WHERE topic_id = _topic_id AND status = 'accepted'
    UNION
    SELECT m.episode_id, 1 AS pref
      FROM episode_topic_slug_map m
      WHERE _slug IS NOT NULL AND m.slug = _slug
        AND coalesce(m.confidence, 1) >= 0.6
    UNION
    SELECT episode_id, 2 AS pref FROM episode_topic_map WHERE topic_id = _topic_id
  ),
  ranked AS (
    SELECT c.episode_id, min(c.pref) AS pref
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1 FROM episode_topic_relevance_reviews r
      WHERE r.topic_id = _topic_id AND r.episode_id = c.episode_id AND r.status = 'rejected'
    )
    GROUP BY c.episode_id
  )
  SELECT e.episode_id, e.title, e.display_title, e.slug, e.image_url, e.published_at,
         e.card_summary, e.audio_url, e.people, e.mentioned, e.topics, e.companies, e.tickers,
         e.podcast_id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured,
         CASE r.pref WHEN 0 THEN 'review' WHEN 1 THEN 'classification' ELSE 'map' END
  FROM ranked r
  JOIN episode_cards e ON e.episode_id = r.episode_id
  JOIN podcasts p ON p.id = e.podcast_id
  WHERE p.language_decision = 'accept_hungarian'
  ORDER BY r.pref, e.published_at DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(_limit, 150), 300));
$$;

GRANT EXECUTE ON FUNCTION public.topic_episodes(uuid, text, integer) TO anon, authenticated, service_role;