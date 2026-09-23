CREATE INDEX IF NOT EXISTS idx_episode_topic_slug_map_slug ON public.episode_topic_slug_map (slug);
CREATE INDEX IF NOT EXISTS idx_episode_topic_map_topic ON public.episode_topic_map (topic_id);
CREATE INDEX IF NOT EXISTS idx_etrr_topic_status ON public.episode_topic_relevance_reviews (topic_id, status);

-- Cut every candidate branch to the page size before merging, so a large topic
-- no longer sorts its full candidate set (that hit the statement timeout).
CREATE OR REPLACE FUNCTION public.topic_episodes(_topic_id uuid, _slug text DEFAULT NULL::text, _limit integer DEFAULT 150)
 RETURNS TABLE(id uuid, title text, display_title text, slug text, image_url text, published_at timestamp with time zone, ai_summary text, audio_url text, people text[], mentioned text[], topics text[], companies text[], tickers text[], podcast_id uuid, podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text, podcast_category text, podcast_rank numeric, podcast_rank_label text, podcast_rss_status text, podcast_featured boolean, source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '12s'
AS $function$
  WITH lim AS (SELECT greatest(1, least(coalesce(_limit, 150), 300)) AS n),
  branches AS (
    (SELECT r.episode_id, 0 AS pref, c.published_at
       FROM episode_topic_relevance_reviews r
       JOIN episode_cards c ON c.episode_id = r.episode_id
      WHERE r.topic_id = _topic_id AND r.status = 'accepted'
      ORDER BY c.published_at DESC NULLS LAST
      LIMIT (SELECT n FROM lim))
    UNION ALL
    (SELECT m.episode_id, 1 AS pref, c.published_at
       FROM episode_topic_slug_map m
       JOIN episode_cards c ON c.episode_id = m.episode_id
      WHERE _slug IS NOT NULL AND m.slug = _slug AND coalesce(m.confidence, 1) >= 0.6
      ORDER BY c.published_at DESC NULLS LAST
      LIMIT (SELECT n FROM lim))
    UNION ALL
    (SELECT t.episode_id, 2 AS pref, c.published_at
       FROM episode_topic_map t
       JOIN episode_cards c ON c.episode_id = t.episode_id
      WHERE t.topic_id = _topic_id
      ORDER BY c.published_at DESC NULLS LAST
      LIMIT (SELECT n FROM lim))
  ),
  ranked AS (
    SELECT b.episode_id, min(b.pref) AS pref, max(b.published_at) AS published_at
      FROM branches b
     WHERE NOT EXISTS (
       SELECT 1 FROM episode_topic_relevance_reviews r
        WHERE r.topic_id = _topic_id AND r.episode_id = b.episode_id AND r.status = 'rejected'
     )
     GROUP BY b.episode_id
  ),
  picked AS (
    SELECT * FROM ranked ORDER BY pref, published_at DESC NULLS LAST LIMIT (SELECT n FROM lim)
  )
  SELECT e.episode_id, e.title, e.display_title, e.slug, e.image_url, e.published_at,
         e.card_summary, e.audio_url, e.people, e.mentioned, e.topics, e.companies, e.tickers,
         e.podcast_id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured,
         CASE k.pref WHEN 0 THEN 'review' WHEN 1 THEN 'classification' ELSE 'map' END
    FROM picked k
    JOIN episode_cards e ON e.episode_id = k.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
   WHERE p.language_decision = 'accept_hungarian'
   ORDER BY k.pref, k.published_at DESC NULLS LAST;
$function$;

-- Counts come from the slim card projection and are capped, so a category page
-- never blocks on a full episodes scan.
CREATE OR REPLACE FUNCTION public.podcast_episode_counts(_ids uuid[])
 RETURNS TABLE(podcast_id uuid, episode_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '8s'
AS $function$
  SELECT c.podcast_id, count(*)::bigint
  FROM public.episode_cards c
  WHERE c.podcast_id = ANY(_ids)
  GROUP BY c.podcast_id
$function$;