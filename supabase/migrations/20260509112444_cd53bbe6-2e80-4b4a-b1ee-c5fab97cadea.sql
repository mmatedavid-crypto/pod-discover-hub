
-- Materialized view: top eligible podcasts × latest N episodes (with podcast metadata embedded)
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_homepage_feed AS
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
  WHERE (p.featured OR (p.rank_label IN ('S','A')))
    AND p.rss_status NOT IN ('failed','inactive')
    AND COALESCE(p.shadow_rank_components->>'health_state','healthy')
        IN ('healthy','recovered_rss_url')
  ORDER BY p.featured DESC NULLS LAST, p.podiverzum_rank DESC
  LIMIT 200
)
SELECT
  e.id            AS episode_id,
  e.title,
  e.display_title,
  e.slug,
  e.summary,
  e.description,
  e.published_at,
  e.audio_url,
  e.topics,
  el.id           AS podcast_id,
  el.slug         AS podcast_slug,
  el.title        AS podcast_title,
  el.display_title AS podcast_display_title,
  el.image_url    AS podcast_image_url,
  el.category     AS podcast_category,
  el.podiverzum_rank,
  el.rank_label,
  el.rss_status,
  el.featured,
  el.featured_rank,
  ROW_NUMBER() OVER (PARTITION BY el.id ORDER BY e.published_at DESC NULLS LAST) AS pod_rank
FROM eligible el
CROSS JOIN LATERAL (
  SELECT *
  FROM public.episodes ep
  WHERE ep.podcast_id = el.id
  ORDER BY ep.published_at DESC NULLS LAST
  LIMIT 10
) e;

-- Indexes for fast slicing
CREATE UNIQUE INDEX IF NOT EXISTS mv_homepage_feed_episode_pkey
  ON public.mv_homepage_feed (episode_id);
CREATE INDEX IF NOT EXISTS mv_homepage_feed_category_pub_idx
  ON public.mv_homepage_feed (podcast_category, published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS mv_homepage_feed_pub_idx
  ON public.mv_homepage_feed (published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS mv_homepage_feed_pod_idx
  ON public.mv_homepage_feed (podcast_id, pod_rank);

-- Refresh function (concurrent so reads don't block)
CREATE OR REPLACE FUNCTION public.refresh_homepage_feed()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_feed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_homepage_feed() TO anon, authenticated;
GRANT SELECT ON public.mv_homepage_feed TO anon, authenticated;
