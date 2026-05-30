DROP MATERIALIZED VIEW IF EXISTS public.mv_homepage_evergreen;
DROP MATERIALIZED VIEW IF EXISTS public.mv_homepage_feed;

CREATE MATERIALIZED VIEW public.mv_homepage_feed AS
WITH eligible AS (
  SELECT
    p.id, p.slug, p.title, p.display_title, p.image_url, p.category,
    p.podiverzum_rank, p.rank_label, p.rss_status, p.featured, p.featured_rank
  FROM public.podcasts p
  WHERE (p.featured OR (COALESCE(p.is_hungarian, false) = true AND p.language_decision = 'accept_hungarian'))
    AND COALESCE(p.rss_status, '') NOT IN ('failed','inactive','deleted')
    AND COALESCE(p.ai_spam_score, 0) < 0.80
    AND COALESCE(p.shadow_rank_components->>'health_state','healthy')
        IN ('healthy','recovered_rss_url')
),
ranked AS (
  SELECT
    e.id AS episode_id, e.title, e.display_title, e.slug, e.summary, e.description,
    e.published_at, e.audio_url, e.topics,
    el.id AS podcast_id, el.slug AS podcast_slug, el.title AS podcast_title,
    el.display_title AS podcast_display_title, el.image_url AS podcast_image_url,
    el.category AS podcast_category, el.podiverzum_rank, el.rank_label, el.rss_status,
    el.featured, el.featured_rank,
    CASE
      WHEN e.published_at >= now() - interval '72 hours' THEN 'hot'
      WHEN e.published_at >= now() - interval '14 days'  THEN 'fresh'
      ELSE 'recent'
    END AS freshness_bucket,
    ROW_NUMBER() OVER (PARTITION BY el.id ORDER BY e.published_at DESC NULLS LAST) AS pod_rank
  FROM eligible el
  CROSS JOIN LATERAL (
    SELECT * FROM public.episodes ep
    WHERE ep.podcast_id = el.id
      AND ep.published_at IS NOT NULL
      AND ep.published_at >= now() - interval '30 days'
      AND ep.title IS NOT NULL
    ORDER BY ep.published_at DESC LIMIT 8
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
  SELECT p.id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured
  FROM public.podcasts p
  WHERE (p.featured OR (COALESCE(p.is_hungarian, false) = true AND p.language_decision = 'accept_hungarian'))
    AND COALESCE(p.rss_status, '') NOT IN ('failed','inactive','deleted')
    AND COALESCE(p.ai_spam_score, 0) < 0.80
    AND COALESCE(p.shadow_rank_components->>'health_state','healthy')
        IN ('healthy','recovered_rss_url')
),
ranked AS (
  SELECT
    e.id AS episode_id, e.title, e.display_title, e.slug,
    e.summary, e.description, e.ai_summary, e.published_at, e.audio_url, e.topics,
    el.id AS podcast_id, el.slug AS podcast_slug, el.title AS podcast_title,
    el.display_title AS podcast_display_title, el.image_url AS podcast_image_url,
    el.category AS podcast_category, el.podiverzum_rank, el.rank_label, el.rss_status, el.featured,
    ROW_NUMBER() OVER (
      PARTITION BY el.id
      ORDER BY
        CASE el.rank_label
          WHEN 'S' THEN 6 WHEN 'A' THEN 5 WHEN 'B' THEN 4
          WHEN 'C' THEN 3 WHEN 'D' THEN 2 ELSE 1
        END DESC,
        el.podiverzum_rank DESC NULLS LAST,
        e.published_at DESC
    ) AS pod_rank
  FROM eligible el
  JOIN public.episodes e ON e.podcast_id = el.id
  WHERE e.ai_summary IS NOT NULL
    AND length(e.ai_summary) > 80
    AND e.published_at IS NOT NULL
    AND e.published_at <  now() - interval '30 days'
    AND e.published_at >= now() - interval '365 days'
    AND e.title IS NOT NULL
)
SELECT * FROM ranked WHERE pod_rank = 1;

CREATE UNIQUE INDEX mv_homepage_evergreen_pkey ON public.mv_homepage_evergreen (episode_id);
CREATE INDEX mv_homepage_evergreen_pod_idx ON public.mv_homepage_evergreen (podcast_id);
CREATE INDEX mv_homepage_evergreen_cat_idx ON public.mv_homepage_evergreen (podcast_category);

GRANT SELECT ON public.mv_homepage_evergreen TO anon, authenticated;

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

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'public_admission_policy',
  jsonb_build_object(
    'version', 1,
    'admission_rule', 'Hungarian non-spam podcasts are admitted; rank only orders and weights them.',
    'hard_exclusions', jsonb_build_array('foreign', 'spam', 'failed/inactive/deleted feed', 'frozen bad health state'),
    'rank_role', 'ordering_and_weight_only'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();