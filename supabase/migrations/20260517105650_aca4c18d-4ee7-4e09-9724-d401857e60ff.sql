
-- Unique constraint for upsert on review queue
ALTER TABLE public.podcast_language_review_queue
  DROP CONSTRAINT IF EXISTS podcast_language_review_queue_podcast_id_key;
ALTER TABLE public.podcast_language_review_queue
  ADD CONSTRAINT podcast_language_review_queue_podcast_id_key UNIQUE (podcast_id);

-- Helper function: single source of truth for "publicly visible Hungarian podcast"
CREATE OR REPLACE FUNCTION public.is_publicly_visible_hu_podcast(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM podcasts
    WHERE id = p_id AND is_hungarian = true AND language_decision = 'accept_hungarian'
  );
$$;

-- Rebuild mv_homepage_feed with strict HU gate
DROP MATERIALIZED VIEW IF EXISTS public.mv_homepage_feed CASCADE;
CREATE MATERIALIZED VIEW public.mv_homepage_feed AS
WITH eligible AS (
  SELECT p.id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured, p.featured_rank
  FROM podcasts p
  WHERE (p.featured OR p.rank_label = ANY (ARRAY['S','A']))
    AND p.rss_status <> ALL (ARRAY['failed','inactive'])
    AND COALESCE(p.shadow_rank_components ->> 'health_state','healthy') = ANY (ARRAY['healthy','recovered_rss_url'])
    AND p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
)
SELECT e.id AS episode_id, e.title, e.display_title, e.slug, e.summary, e.description,
       e.published_at, e.audio_url, e.topics,
       el.id AS podcast_id, el.slug AS podcast_slug, el.title AS podcast_title,
       el.display_title AS podcast_display_title, el.image_url AS podcast_image_url,
       el.category AS podcast_category, el.podiverzum_rank, el.rank_label,
       el.rss_status, el.featured, el.featured_rank,
       CASE
         WHEN e.published_at >= now() - interval '72 hours' THEN 'hot'
         WHEN e.published_at >= now() - interval '14 days'  THEN 'fresh'
         ELSE 'recent'
       END AS freshness_bucket,
       row_number() OVER (PARTITION BY el.id ORDER BY e.published_at DESC NULLS LAST) AS pod_rank
FROM eligible el
CROSS JOIN LATERAL (
  SELECT ep.* FROM episodes ep
  WHERE ep.podcast_id = el.id
    AND ep.published_at IS NOT NULL
    AND ep.published_at >= now() - interval '30 days'
    AND ep.title IS NOT NULL
  ORDER BY ep.published_at DESC
  LIMIT 8
) e;

CREATE UNIQUE INDEX IF NOT EXISTS mv_homepage_feed_pkey
  ON public.mv_homepage_feed (episode_id);
CREATE INDEX IF NOT EXISTS mv_homepage_feed_published_idx
  ON public.mv_homepage_feed (published_at DESC);
CREATE INDEX IF NOT EXISTS mv_homepage_feed_podcast_idx
  ON public.mv_homepage_feed (podcast_id);

-- Rebuild mv_homepage_evergreen with strict HU gate
DROP MATERIALIZED VIEW IF EXISTS public.mv_homepage_evergreen CASCADE;
CREATE MATERIALIZED VIEW public.mv_homepage_evergreen AS
WITH s_tier AS (
  SELECT p.id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured
  FROM podcasts p
  WHERE p.rank_label = 'S'
    AND p.rss_status <> ALL (ARRAY['failed','inactive'])
    AND COALESCE(p.shadow_rank_components ->> 'health_state','healthy') = ANY (ARRAY['healthy','recovered_rss_url'])
    AND p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
), ranked AS (
  SELECT e.id AS episode_id, e.title, e.display_title, e.slug, e.summary, e.description,
         e.ai_summary, e.published_at, e.audio_url, e.topics,
         st.id AS podcast_id, st.slug AS podcast_slug, st.title AS podcast_title,
         st.display_title AS podcast_display_title, st.image_url AS podcast_image_url,
         st.category AS podcast_category, st.podiverzum_rank, st.rank_label,
         st.rss_status, st.featured,
         row_number() OVER (PARTITION BY st.id ORDER BY e.published_at DESC) AS pod_rank
  FROM s_tier st
  JOIN episodes e ON e.podcast_id = st.id
  WHERE e.ai_summary IS NOT NULL AND length(e.ai_summary) > 80
    AND e.published_at IS NOT NULL
    AND e.published_at < now() - interval '30 days'
    AND e.published_at >= now() - interval '365 days'
    AND e.title IS NOT NULL
)
SELECT episode_id, title, display_title, slug, summary, description, ai_summary,
       published_at, audio_url, topics, podcast_id, podcast_slug, podcast_title,
       podcast_display_title, podcast_image_url, podcast_category, podiverzum_rank,
       rank_label, rss_status, featured, pod_rank
FROM ranked WHERE pod_rank = 1;

CREATE UNIQUE INDEX IF NOT EXISTS mv_homepage_evergreen_pkey
  ON public.mv_homepage_evergreen (episode_id);

-- Refresh both immediately so the foreign deletions + strict gate take effect
REFRESH MATERIALIZED VIEW public.mv_homepage_feed;
REFRESH MATERIALIZED VIEW public.mv_homepage_evergreen;
