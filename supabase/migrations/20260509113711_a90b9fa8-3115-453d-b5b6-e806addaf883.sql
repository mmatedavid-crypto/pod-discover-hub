
-- Rebuild homepage MV with strict freshness rules + add evergreen v0 MV.
-- Trending/category limit: 30 days max. Evergreen: S-tier, 30–365 days, must have ai_summary.

DROP MATERIALIZED VIEW IF EXISTS public.mv_homepage_feed;

CREATE MATERIALIZED VIEW public.mv_homepage_feed AS
WITH eligible AS (
  SELECT
    p.id, p.slug, p.title, p.display_title, p.image_url, p.category,
    p.podiverzum_rank, p.rank_label, p.rss_status, p.featured, p.featured_rank
  FROM public.podcasts p
  WHERE (p.featured OR p.rank_label IN ('S','A'))
    AND p.rss_status NOT IN ('failed','inactive')
    AND COALESCE(p.shadow_rank_components->>'health_state','healthy')
        IN ('healthy','recovered_rss_url')
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
  CASE
    WHEN e.published_at >= now() - interval '72 hours' THEN 'hot'
    WHEN e.published_at >= now() - interval '14 days'  THEN 'fresh'
    ELSE 'recent'
  END AS freshness_bucket,
  ROW_NUMBER() OVER (PARTITION BY el.id ORDER BY e.published_at DESC NULLS LAST) AS pod_rank
FROM eligible el
CROSS JOIN LATERAL (
  SELECT *
  FROM public.episodes ep
  WHERE ep.podcast_id = el.id
    AND ep.published_at IS NOT NULL
    AND ep.published_at >= now() - interval '30 days'
    AND ep.title IS NOT NULL
  ORDER BY ep.published_at DESC
  LIMIT 8
) e;

CREATE UNIQUE INDEX mv_homepage_feed_episode_pkey
  ON public.mv_homepage_feed (episode_id);
CREATE INDEX mv_homepage_feed_category_pub_idx
  ON public.mv_homepage_feed (podcast_category, published_at DESC NULLS LAST);
CREATE INDEX mv_homepage_feed_pub_idx
  ON public.mv_homepage_feed (published_at DESC NULLS LAST);
CREATE INDEX mv_homepage_feed_pod_idx
  ON public.mv_homepage_feed (podcast_id, pod_rank);
CREATE INDEX mv_homepage_feed_bucket_idx
  ON public.mv_homepage_feed (freshness_bucket, published_at DESC NULLS LAST);

GRANT SELECT ON public.mv_homepage_feed TO anon, authenticated;

-- Evergreen v0: S-tier, 30–365 days old, AI-summarized (quality signal), 1 per podcast.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_homepage_evergreen AS
WITH s_tier AS (
  SELECT p.id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured
  FROM public.podcasts p
  WHERE p.rank_label = 'S'
    AND p.rss_status NOT IN ('failed','inactive')
    AND COALESCE(p.shadow_rank_components->>'health_state','healthy')
        IN ('healthy','recovered_rss_url')
),
ranked AS (
  SELECT
    e.id            AS episode_id,
    e.title, e.display_title, e.slug,
    e.summary, e.description, e.ai_summary,
    e.published_at, e.audio_url, e.topics,
    st.id           AS podcast_id,
    st.slug         AS podcast_slug,
    st.title        AS podcast_title,
    st.display_title AS podcast_display_title,
    st.image_url    AS podcast_image_url,
    st.category     AS podcast_category,
    st.podiverzum_rank, st.rank_label, st.rss_status, st.featured,
    ROW_NUMBER() OVER (PARTITION BY st.id ORDER BY e.published_at DESC) AS pod_rank
  FROM s_tier st
  JOIN public.episodes e ON e.podcast_id = st.id
  WHERE e.ai_summary IS NOT NULL
    AND length(e.ai_summary) > 80
    AND e.published_at IS NOT NULL
    AND e.published_at <  now() - interval '30 days'
    AND e.published_at >= now() - interval '365 days'
    AND e.title IS NOT NULL
)
SELECT * FROM ranked WHERE pod_rank = 1;

CREATE UNIQUE INDEX mv_homepage_evergreen_pkey
  ON public.mv_homepage_evergreen (episode_id);
CREATE INDEX mv_homepage_evergreen_pod_idx
  ON public.mv_homepage_evergreen (podcast_id);
CREATE INDEX mv_homepage_evergreen_cat_idx
  ON public.mv_homepage_evergreen (podcast_category);

GRANT SELECT ON public.mv_homepage_evergreen TO anon, authenticated;

-- Update refresh function to refresh BOTH MVs.
CREATE OR REPLACE FUNCTION public.refresh_homepage_feed()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_feed;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_evergreen;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_homepage_feed() TO anon, authenticated;

-- Initial population (non-concurrent, one-time)
REFRESH MATERIALIZED VIEW public.mv_homepage_feed;
REFRESH MATERIALIZED VIEW public.mv_homepage_evergreen;
