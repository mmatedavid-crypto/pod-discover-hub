
DROP MATERIALIZED VIEW IF EXISTS public.mv_homepage_evergreen;

CREATE MATERIALIZED VIEW public.mv_homepage_evergreen AS
WITH eligible AS (
  SELECT p.id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured
  FROM podcasts p
  WHERE (p.featured OR COALESCE(p.is_hungarian, false) = true AND p.language_decision = 'accept_hungarian')
    AND COALESCE(p.rss_status, '') NOT IN ('failed','inactive','deleted')
    AND COALESCE(p.ai_spam_score, 0::numeric) < 0.80
    AND COALESCE(p.shadow_rank_components->>'health_state','healthy') IN ('healthy','recovered_rss_url')
),
ranked AS (
  SELECT
    e.id AS episode_id, e.title, e.display_title, e.slug,
    e.summary, e.description, e.ai_summary, e.published_at,
    e.audio_url, e.topics,
    el.id AS podcast_id, el.slug AS podcast_slug,
    el.title AS podcast_title, el.display_title AS podcast_display_title,
    el.image_url AS podcast_image_url, el.category AS podcast_category,
    el.podiverzum_rank, el.rank_label, el.rss_status, el.featured,
    eyl.youtube_view_count,
    row_number() OVER (
      PARTITION BY el.id
      ORDER BY eyl.youtube_view_count DESC NULLS LAST, e.published_at DESC
    ) AS pod_rank
  FROM eligible el
  JOIN episodes e ON e.podcast_id = el.id
  JOIN episode_youtube_links eyl
    ON eyl.episode_id = e.id
   AND eyl.status = 'confirmed'
   AND eyl.youtube_view_count IS NOT NULL
   AND eyl.youtube_view_count > 0
  WHERE e.published_at IS NOT NULL
    AND e.published_at < (now() - interval '30 days')
    AND e.title IS NOT NULL
)
SELECT episode_id, title, display_title, slug, summary, description, ai_summary,
       published_at, audio_url, topics, podcast_id, podcast_slug, podcast_title,
       podcast_display_title, podcast_image_url, podcast_category,
       podiverzum_rank, rank_label, rss_status, featured,
       youtube_view_count, pod_rank
FROM ranked
WHERE pod_rank = 1
ORDER BY youtube_view_count DESC NULLS LAST;

CREATE UNIQUE INDEX mv_homepage_evergreen_pkey ON public.mv_homepage_evergreen (episode_id);
CREATE INDEX mv_homepage_evergreen_pod_idx ON public.mv_homepage_evergreen (podcast_id);
CREATE INDEX mv_homepage_evergreen_cat_idx ON public.mv_homepage_evergreen (podcast_category);
CREATE INDEX mv_homepage_evergreen_views_idx ON public.mv_homepage_evergreen (youtube_view_count DESC NULLS LAST);

GRANT SELECT ON public.mv_homepage_evergreen TO anon, authenticated;
GRANT ALL ON public.mv_homepage_evergreen TO service_role;
