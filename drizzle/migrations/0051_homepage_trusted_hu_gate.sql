-- Homepage trusted-HU gate (2026-09-25):
-- Every homepage surface may only surface podcasts that are
--   1) verified Hungarian by the language filter (is_hungarian + accept_hungarian + detected_language='hu'),
--   2) already ranked (rank_label IS NOT NULL),
--   3) in the catalog for 14+ days.
-- Same rule as the homepage ticker (LiveIndexBar). Newly arrived / unverified
-- shows never appear on the homepage until the language filter confirms them.
-- "featured" is an ordering signal, not a language/trust bypass — the old
-- `p.featured OR (...)` shortcut is removed.

DROP MATERIALIZED VIEW IF EXISTS public.mv_homepage_evergreen;
DROP MATERIALIZED VIEW IF EXISTS public.mv_homepage_feed;

CREATE MATERIALIZED VIEW public.mv_homepage_feed AS
WITH eligible AS (
  SELECT
    p.id,
    p.slug,
    p.title,
    p.display_title,
    p.image_url,
    p.category,
    p.podiverzum_rank,
    p.rank_label,
    p.rss_status,
    p.featured,
    p.featured_rank
  FROM public.podcasts p
  WHERE p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND COALESCE(p.detected_language, '') = 'hu'
    AND p.rank_label IS NOT NULL
    AND p.created_at < now() - interval '14 days'
    AND COALESCE(p.rss_status, '') NOT IN ('failed', 'inactive', 'deleted')
    AND COALESCE(p.ai_spam_score, 0) < 0.80
    AND COALESCE(p.shadow_rank_components->>'health_state', 'healthy') IN ('healthy', 'recovered_rss_url')
),
ranked AS (
  SELECT
    e.id AS episode_id,
    e.title,
    e.display_title,
    e.slug,
    e.summary,
    e.description,
    e.published_at,
    e.audio_url,
    e.topics,
    el.id AS podcast_id,
    el.slug AS podcast_slug,
    el.title AS podcast_title,
    el.display_title AS podcast_display_title,
    el.image_url AS podcast_image_url,
    el.category AS podcast_category,
    el.podiverzum_rank,
    el.rank_label,
    el.rss_status,
    el.featured,
    el.featured_rank,
    CASE
      WHEN e.published_at >= now() - interval '72 hours' THEN 'hot'
      WHEN e.published_at >= now() - interval '14 days' THEN 'fresh'
      ELSE 'recent'
    END AS freshness_bucket,
    ROW_NUMBER() OVER (
      PARTITION BY el.id
      ORDER BY e.published_at DESC NULLS LAST
    ) AS pod_rank
  FROM eligible el
  CROSS JOIN LATERAL (
    SELECT ep.*
    FROM public.episodes ep
    WHERE ep.podcast_id = el.id
      AND ep.published_at IS NOT NULL
      AND ep.published_at >= now() - interval '30 days'
      AND ep.title IS NOT NULL
    ORDER BY ep.published_at DESC NULLS LAST
    LIMIT 8
  ) e
)
SELECT * FROM ranked;

CREATE UNIQUE INDEX mv_homepage_feed_episode_pkey ON public.mv_homepage_feed (episode_id);
CREATE INDEX mv_homepage_feed_category_pub_idx ON public.mv_homepage_feed (podcast_category, published_at DESC NULLS LAST);
CREATE INDEX mv_homepage_feed_pub_idx ON public.mv_homepage_feed (published_at DESC NULLS LAST);
CREATE INDEX mv_homepage_feed_pod_idx ON public.mv_homepage_feed (podcast_id, pod_rank);
CREATE INDEX mv_homepage_feed_bucket_idx ON public.mv_homepage_feed (freshness_bucket, published_at DESC NULLS LAST);

GRANT SELECT ON public.mv_homepage_feed TO anon, authenticated;

CREATE MATERIALIZED VIEW public.mv_homepage_evergreen AS
WITH eligible AS (
  SELECT
    p.id,
    p.slug,
    p.title,
    p.display_title,
    p.image_url,
    p.category,
    p.podiverzum_rank,
    p.rank_label,
    p.rss_status,
    p.featured
  FROM public.podcasts p
  WHERE p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND COALESCE(p.detected_language, '') = 'hu'
    AND p.rank_label IS NOT NULL
    AND p.created_at < now() - interval '14 days'
    AND COALESCE(p.rss_status, '') NOT IN ('failed', 'inactive', 'deleted')
    AND COALESCE(p.ai_spam_score, 0) < 0.80
    AND COALESCE(p.shadow_rank_components->>'health_state', 'healthy') IN ('healthy', 'recovered_rss_url')
),
ranked AS (
  SELECT
    e.id AS episode_id,
    e.title,
    e.display_title,
    e.slug,
    e.summary,
    e.description,
    e.ai_summary,
    e.published_at,
    e.audio_url,
    e.topics,
    el.id AS podcast_id,
    el.slug AS podcast_slug,
    el.title AS podcast_title,
    el.display_title AS podcast_display_title,
    el.image_url AS podcast_image_url,
    el.category AS podcast_category,
    el.podiverzum_rank,
    el.rank_label,
    el.rss_status,
    el.featured,
    eyl.youtube_view_count,
    ROW_NUMBER() OVER (
      PARTITION BY el.id
      ORDER BY eyl.youtube_view_count DESC NULLS LAST, e.published_at DESC
    ) AS pod_rank
  FROM eligible el
  JOIN public.episodes e ON e.podcast_id = el.id
  JOIN public.episode_youtube_links eyl
    ON eyl.episode_id = e.id
   AND eyl.status = 'confirmed'
   AND eyl.youtube_view_count IS NOT NULL
   AND eyl.youtube_view_count > 0
  WHERE e.published_at IS NOT NULL
    AND e.published_at < now() - interval '30 days'
    AND e.title IS NOT NULL
)
SELECT * FROM ranked WHERE pod_rank = 1
ORDER BY youtube_view_count DESC NULLS LAST;

CREATE UNIQUE INDEX mv_homepage_evergreen_pkey ON public.mv_homepage_evergreen (episode_id);
CREATE INDEX mv_homepage_evergreen_pod_idx ON public.mv_homepage_evergreen (podcast_id);
CREATE INDEX mv_homepage_evergreen_cat_idx ON public.mv_homepage_evergreen (podcast_category);

GRANT SELECT ON public.mv_homepage_evergreen TO anon, authenticated;

-- "Felkapott műsorok" rail: same trusted-HU gate.
CREATE OR REPLACE FUNCTION public.get_trending_podcasts(p_limit integer DEFAULT 12)
RETURNS TABLE(id uuid, title text, display_title text, slug text, summary text, description text, image_url text, category text, apple_url text, spotify_url text, youtube_url text, website_url text, podiverzum_rank numeric, rank_label text, trending_score numeric, sources jsonb, snapshot_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH latest_snap AS (
    SELECT source, max(snapshot_at) AS snap
    FROM public.podcast_charts
    WHERE country = 'hu'
      AND snapshot_at > now() - interval '7 days'
    GROUP BY source
  ),
  current_charts AS (
    SELECT DISTINCT ON (c.podcast_id, c.source)
      c.podcast_id, c.source, c.rank, c.snapshot_at
    FROM public.podcast_charts c
    JOIN latest_snap ls ON ls.source = c.source AND ls.snap = c.snapshot_at
    WHERE c.podcast_id IS NOT NULL
    ORDER BY c.podcast_id, c.source, c.rank ASC
  ),
  scored AS (
    SELECT
      podcast_id,
      sum(1.0 / (60.0 + rank))::numeric AS trending_score,
      jsonb_agg(jsonb_build_object('source', source, 'rank', rank) ORDER BY rank) AS sources,
      max(snapshot_at) AS snapshot_at,
      min(rank) AS best_rank,
      count(DISTINCT source) AS source_count
    FROM current_charts
    GROUP BY podcast_id
  )
  SELECT
    p.id, p.title, p.display_title, p.slug, p.summary, p.description,
    p.image_url, p.category, p.apple_url, p.spotify_url, p.youtube_url, p.website_url,
    p.podiverzum_rank, p.rank_label,
    s.trending_score, s.sources, s.snapshot_at
  FROM scored s
  JOIN public.podcasts p ON p.id = s.podcast_id
  WHERE p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND COALESCE(p.detected_language, '') = 'hu'
    AND p.rank_label IS NOT NULL
    AND p.created_at < now() - interval '14 days'
    AND COALESCE(p.rss_status, '') NOT IN ('failed', 'inactive', 'deleted')
    AND COALESCE(p.ai_spam_score, 0) < 0.80
    AND COALESCE(p.shadow_rank_components->>'health_state', 'healthy')
        IN ('healthy', 'recovered_rss_url')
  ORDER BY s.source_count DESC, s.trending_score DESC, s.best_rank ASC, COALESCE(p.podiverzum_rank, 0) DESC
  LIMIT greatest(1, least(coalesce(p_limit, 12), 50));
$function$;

GRANT EXECUTE ON FUNCTION public.get_trending_podcasts(integer) TO anon, authenticated;

-- Rebuild both views immediately so the homepage serves from the gated data.
REFRESH MATERIALIZED VIEW public.mv_homepage_feed;
REFRESH MATERIALIZED VIEW public.mv_homepage_evergreen;