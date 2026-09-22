-- Repoint the topic / person episode list functions at the slim episode_cards
-- projection and include the AI-classification topic source the topic page used.
DROP FUNCTION IF EXISTS public.topic_episodes(uuid, integer);
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
    SELECT c.episode_id, 1 AS pref
      FROM episode_ai_classifications c
      WHERE _slug IS NOT NULL
        AND c.classification_status = 'classified'
        AND c.topics @> jsonb_build_array(jsonb_build_object('slug', _slug))
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

DROP FUNCTION IF EXISTS public.person_episodes(uuid, integer);
CREATE FUNCTION public.person_episodes(_person_id uuid, _limit integer DEFAULT 250)
RETURNS TABLE (
  id uuid, title text, display_title text, slug text, image_url text,
  published_at timestamptz, ai_summary text, audio_url text,
  people text[], mentioned text[], topics text[], companies text[], tickers text[],
  podcast_id uuid, podcast_slug text, podcast_title text, podcast_display_title text,
  podcast_image_url text, podcast_category text, podcast_rank numeric,
  podcast_rank_label text, podcast_rss_status text, podcast_featured boolean,
  mention_type text, role_type text, confidence numeric,
  relevance_status text, validation_source text, final_relevance_score numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '12s'
AS $$
  SELECT e.episode_id, e.title, e.display_title, e.slug, e.image_url, e.published_at,
         e.card_summary, e.audio_url, e.people, e.mentioned, e.topics, e.companies, e.tickers,
         e.podcast_id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured,
         m.mention_type, m.role_type, m.confidence, m.relevance_status,
         m.validation_source, m.final_relevance_score
  FROM person_episode_mentions m
  JOIN episode_cards e ON e.episode_id = m.episode_id
  JOIN podcasts p ON p.id = e.podcast_id
  WHERE m.person_id = _person_id
    AND coalesce(m.relevance_status, 'pending') NOT IN ('rejected', 'needs_review')
    AND p.language_decision = 'accept_hungarian'
  ORDER BY m.final_relevance_score DESC NULLS LAST, e.published_at DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(_limit, 250), 400));
$$;

GRANT EXECUTE ON FUNCTION public.topic_episodes(uuid, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.person_episodes(uuid, integer) TO anon, authenticated, service_role;