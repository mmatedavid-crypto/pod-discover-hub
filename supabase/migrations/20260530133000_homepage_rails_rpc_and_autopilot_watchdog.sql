-- Keep clean_text_autopilot registered exactly once, with its own spend key.
UPDATE public.app_settings
SET value = jsonb_set(
  value,
  '{runners}',
  (
    SELECT COALESCE(jsonb_agg(r), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(value->'runners', '[]'::jsonb)) r
    WHERE r->>'name' <> 'clean_text_autopilot'
  )
  || jsonb_build_array(
    jsonb_build_object(
      'name', 'clean_text_autopilot',
      'controls_key', 'clean_text_autopilot',
      'progress_key', 'clean_text_autopilot',
      'spend_key', 'clean_text_autopilot_usd',
      'cadence_minutes', 10,
      'min_processed_for_error_rate', 5
    )
  ),
  true
),
updated_at = now()
WHERE key = 'watchdog_state';

CREATE OR REPLACE FUNCTION public.get_homepage_rails_v1(
  _trending_limit integer DEFAULT 8,
  _evergreen_limit integer DEFAULT 6,
  _category_limit integer DEFAULT 6,
  _max_categories integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH feed_base AS (
  SELECT
    f.*,
    lower(concat_ws(
      ' ',
      f.podcast_category,
      f.podcast_title,
      f.podcast_display_title,
      f.title,
      f.display_title
    )) AS hay
  FROM public.mv_homepage_feed f
  WHERE f.pod_rank <= 6
    AND f.audio_url IS NOT NULL
),
scored AS (
  SELECT
    b.*,
    (
      CASE b.rank_label
        WHEN 'S' THEN 100
        WHEN 'A' THEN 75
        WHEN 'B' THEN 45
        WHEN 'C' THEN 25
        WHEN 'D' THEN 8
        WHEN 'E' THEN 8
        ELSE 12
      END
      + CASE WHEN b.featured THEN 25 ELSE 0 END
      + CASE
          WHEN b.featured AND b.featured_rank IS NOT NULL
          THEN greatest(0, 12 - least(12, b.featured_rank))
          ELSE 0
        END
      + least(greatest(coalesce(b.podiverzum_rank, 0), 0), 10) * 3
      + CASE
          WHEN b.published_at >= now() - interval '24 hours' THEN 30
          WHEN b.published_at >= now() - interval '14 days' THEN 10
          ELSE 0
        END
      - CASE
          WHEN b.hay ~ '(hirek|h.r|h.r-.sszefoglal.|napi h.r|esti h.r|reggeli h.r|kronika|kr.nika|infostart|h.rpercek|h.rm.sor)' THEN 12
          ELSE 0
        END
      - CASE
          WHEN lower(coalesce(b.display_title, b.title, '')) ~ '(^[[:space:]]*[0-9]{1,2}[[:space:]]*[-–—][[:space:]]+.|^[[:space:]]*20[0-9]{6}([[:space:]]|[-–—])|^[[:space:]]*[0-9]{1,2}[[:space:]]+(ora|.ra|perc)($|[[:space:]])|hirek roviden|h.rek r.viden|percben|perc h.r)' THEN 35
          ELSE 0
        END
    ) AS homepage_score,
    (b.hay ~ '(hirek|h.r|h.r-.sszefoglal.|napi h.r|esti h.r|reggeli h.r|kronika|kr.nika|infostart|h.rpercek|h.rm.sor)') AS news_like,
    (lower(coalesce(b.display_title, b.title, '')) ~ '(^[[:space:]]*[0-9]{1,2}[[:space:]]*[-–—][[:space:]]+.|^[[:space:]]*20[0-9]{6}([[:space:]]|[-–—])|^[[:space:]]*[0-9]{1,2}[[:space:]]+(ora|.ra|perc)($|[[:space:]])|hirek roviden|h.rek r.viden|percben|perc h.r)') AS bulletin_like
  FROM feed_base b
),
trending_pool AS (
  SELECT
    s.*,
    row_number() OVER (
      PARTITION BY s.podcast_id
      ORDER BY s.homepage_score DESC, s.published_at DESC NULLS LAST
    ) AS podcast_pick_rank
  FROM scored s
  WHERE s.freshness_bucket IN ('hot', 'fresh')
     OR s.published_at >= now() - interval '30 days'
),
trending_capped AS (
  SELECT
    t.*,
    sum(CASE WHEN t.news_like THEN 1 ELSE 0 END) OVER (
      ORDER BY t.homepage_score DESC, t.published_at DESC NULLS LAST
    ) AS news_pick_rank,
    sum(CASE WHEN t.bulletin_like THEN 1 ELSE 0 END) OVER (
      ORDER BY t.homepage_score DESC, t.published_at DESC NULLS LAST
    ) AS bulletin_pick_rank
  FROM trending_pool t
  WHERE t.podcast_pick_rank <= 2
),
trending_primary AS (
  SELECT *
  FROM trending_capped
  WHERE (NOT news_like OR coalesce(news_pick_rank, 0) <= 2)
    AND (NOT bulletin_like OR coalesce(bulletin_pick_rank, 0) <= 1)
  ORDER BY homepage_score DESC, published_at DESC NULLS LAST
  LIMIT _trending_limit
),
trending_backfill AS (
  SELECT c.*
  FROM trending_capped c
  WHERE NOT EXISTS (
    SELECT 1 FROM trending_primary p WHERE p.episode_id = c.episode_id
  )
  ORDER BY c.homepage_score DESC, c.published_at DESC NULLS LAST
  LIMIT greatest(_trending_limit - (SELECT count(*)::integer FROM trending_primary), 0)
),
trending AS (
  SELECT * FROM trending_primary
  UNION ALL
  SELECT * FROM trending_backfill
),
category_names AS (
  SELECT s.podcast_category
  FROM scored s
  WHERE s.podcast_category IS NOT NULL
  GROUP BY s.podcast_category
  ORDER BY max(s.homepage_score) DESC, max(s.published_at) DESC NULLS LAST
  LIMIT _max_categories
),
category_ranked AS (
  SELECT
    s.*,
    row_number() OVER (
      PARTITION BY s.podcast_category, s.podcast_id
      ORDER BY s.homepage_score DESC, s.published_at DESC NULLS LAST
    ) AS category_podcast_rank
  FROM scored s
  JOIN category_names c ON c.podcast_category = s.podcast_category
),
category_limited AS (
  SELECT *
  FROM (
    SELECT
      cr.*,
      row_number() OVER (
        PARTITION BY cr.podcast_category
        ORDER BY cr.category_podcast_rank ASC, cr.homepage_score DESC, cr.published_at DESC NULLS LAST
      ) AS category_rank
    FROM category_ranked cr
    WHERE cr.category_podcast_rank <= 2
  ) x
  WHERE x.category_rank <= _category_limit
),
evergreen AS (
  SELECT e.*
  FROM public.mv_homepage_evergreen e
  WHERE e.audio_url IS NOT NULL
  ORDER BY coalesce(e.podiverzum_rank, 0) DESC, e.published_at DESC NULLS LAST
  LIMIT _evergreen_limit
),
trending_json AS (
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'episode_id', episode_id,
        'title', title,
        'display_title', display_title,
        'slug', slug,
        'summary', summary,
        'description', description,
        'published_at', published_at,
        'audio_url', audio_url,
        'topics', topics,
        'podcast_id', podcast_id,
        'podcast_slug', podcast_slug,
        'podcast_title', podcast_title,
        'podcast_display_title', podcast_display_title,
        'podcast_image_url', podcast_image_url,
        'podcast_category', podcast_category,
        'podiverzum_rank', podiverzum_rank,
        'rank_label', rank_label,
        'rss_status', rss_status,
        'featured', featured,
        'featured_rank', featured_rank,
        'pod_rank', pod_rank,
        'freshness_bucket', freshness_bucket
      )
      ORDER BY homepage_score DESC, published_at DESC NULLS LAST
    ),
    '[]'::jsonb
  ) AS items
  FROM trending
),
evergreen_json AS (
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'episode_id', episode_id,
        'title', title,
        'display_title', display_title,
        'slug', slug,
        'summary', summary,
        'description', description,
        'ai_summary', ai_summary,
        'published_at', published_at,
        'audio_url', audio_url,
        'topics', topics,
        'podcast_id', podcast_id,
        'podcast_slug', podcast_slug,
        'podcast_title', podcast_title,
        'podcast_display_title', podcast_display_title,
        'podcast_image_url', podcast_image_url,
        'podcast_category', podcast_category,
        'podiverzum_rank', podiverzum_rank,
        'rank_label', rank_label,
        'rss_status', rss_status,
        'featured', featured,
        'pod_rank', pod_rank
      )
      ORDER BY coalesce(podiverzum_rank, 0) DESC, published_at DESC NULLS LAST
    ),
    '[]'::jsonb
  ) AS items
  FROM evergreen
),
category_json AS (
  SELECT coalesce(
    jsonb_object_agg(podcast_category, items),
    '{}'::jsonb
  ) AS items
  FROM (
    SELECT
      podcast_category,
      jsonb_agg(
        jsonb_build_object(
          'episode_id', episode_id,
          'title', title,
          'display_title', display_title,
          'slug', slug,
          'summary', summary,
          'description', description,
          'published_at', published_at,
          'audio_url', audio_url,
          'topics', topics,
          'podcast_id', podcast_id,
          'podcast_slug', podcast_slug,
          'podcast_title', podcast_title,
          'podcast_display_title', podcast_display_title,
          'podcast_image_url', podcast_image_url,
          'podcast_category', podcast_category,
          'podiverzum_rank', podiverzum_rank,
          'rank_label', rank_label,
          'rss_status', rss_status,
          'featured', featured,
          'featured_rank', featured_rank,
          'pod_rank', pod_rank,
          'freshness_bucket', freshness_bucket
        )
        ORDER BY category_rank ASC
      ) AS items
    FROM category_limited
    GROUP BY podcast_category
  ) per_category
)
SELECT jsonb_build_object(
  'trending', (SELECT items FROM trending_json),
  'evergreen', (SELECT items FROM evergreen_json),
  'categories', (SELECT items FROM category_json)
);
$$;

GRANT EXECUTE ON FUNCTION public.get_homepage_rails_v1(integer, integer, integer, integer) TO anon, authenticated;
