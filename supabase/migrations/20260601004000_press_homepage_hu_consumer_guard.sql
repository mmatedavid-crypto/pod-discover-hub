-- Press-launch homepage guard:
-- the consumer homepage, prerender and public rails must only surface Hungarian,
-- non-spam, playable episodes. "Featured" is an ordering signal, not a bypass.

DROP FUNCTION IF EXISTS public.get_homepage_rails_v1(integer, integer, integer, integer);
DROP FUNCTION IF EXISTS public.refresh_homepage_feed();

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
  WHERE (COALESCE(p.is_hungarian, false) = true OR p.language_decision = 'accept_hungarian')
    AND COALESCE(p.language_decision, 'accept_hungarian') NOT IN ('reject_foreign', 'confirmed_foreign', 'reject_non_hungarian')
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
    SELECT *
    FROM public.episodes ep
    WHERE ep.podcast_id = el.id
      AND ep.published_at IS NOT NULL
      AND ep.published_at >= now() - interval '30 days'
      AND ep.title IS NOT NULL
      AND ep.audio_url IS NOT NULL
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
  WHERE (COALESCE(p.is_hungarian, false) = true OR p.language_decision = 'accept_hungarian')
    AND COALESCE(p.language_decision, 'accept_hungarian') NOT IN ('reject_foreign', 'confirmed_foreign', 'reject_non_hungarian')
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
    ROW_NUMBER() OVER (
      PARTITION BY el.id
      ORDER BY
        CASE el.rank_label
          WHEN 'S' THEN 6
          WHEN 'A' THEN 5
          WHEN 'B' THEN 4
          WHEN 'C' THEN 3
          WHEN 'D' THEN 2
          ELSE 1
        END DESC,
        el.podiverzum_rank DESC NULLS LAST,
        e.published_at DESC NULLS LAST
    ) AS pod_rank
  FROM eligible el
  JOIN public.episodes e ON e.podcast_id = el.id
  WHERE e.ai_summary IS NOT NULL
    AND length(e.ai_summary) > 80
    AND e.published_at IS NOT NULL
    AND e.published_at < now() - interval '30 days'
    AND e.published_at >= now() - interval '365 days'
    AND e.title IS NOT NULL
    AND e.audio_url IS NOT NULL
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
    ep.ai_summary,
    ep.clean_text_status,
    ep.people,
    ep.companies,
    ep.organizations,
    ep.entity_extraction_evidence,
    ect.cleaner_method,
    length(coalesce(ect.cleaned_text, f.description, f.summary, '')) AS clean_text_len,
    coalesce(ebts.source_confidence, 0)::numeric AS text_source_confidence,
    lower(concat_ws(' ', f.podcast_category, f.podcast_title, f.podcast_display_title, f.title, f.display_title)) AS hay
  FROM public.mv_homepage_feed f
  JOIN public.episodes ep ON ep.id = f.episode_id
  JOIN public.podcasts p ON p.id = f.podcast_id
  LEFT JOIN public.episode_clean_text ect ON ect.episode_id = f.episode_id
  LEFT JOIN public.episode_best_text_source ebts ON ebts.episode_id = f.episode_id
  WHERE f.pod_rank <= 8
    AND f.audio_url IS NOT NULL
    AND (COALESCE(p.is_hungarian, false) = true OR p.language_decision = 'accept_hungarian')
    AND COALESCE(p.language_decision, 'accept_hungarian') NOT IN ('reject_foreign', 'confirmed_foreign', 'reject_non_hungarian')
    AND COALESCE(p.rss_status, '') NOT IN ('failed', 'inactive', 'deleted')
    AND COALESCE(p.ai_spam_score, 0) < 0.80
),
scored AS (
  SELECT
    b.*,
    (
      b.hay ~ '(hírek|hirek|h.r|h.r-.sszefoglal.|napi h.r|esti h.r|reggeli h.r|krónika|kronika|infostart|h.rpercek|h.rm.sor|összes hír|osszes hir)'
    ) AS news_like,
    (
      lower(coalesce(b.display_title, b.title, '')) ~ '(^[[:space:]]*[0-9]{1,2}[[:space:]]*[-–—][[:space:]]+.|^[[:space:]]*20[0-9]{6}([[:space:]]|[-–—])|^[[:space:]]*[0-9]{1,2}[[:space:]]+(óra|ora|perc)($|[[:space:]])|hírek röviden|hirek roviden|percben|perc h.r)'
    ) AS bulletin_like,
    CASE
      WHEN b.podcast_category = 'Religion & Spirituality'
        OR b.hay ~ '(zarándok|zarandok|igehirdet|istentisztelet|biblia|evangélium|evangelium|katolikus|református|reformatus|keresztény|kereszteny|egyházi|egyhazi|prédikáció|predikacio|ima|imádság|imadsag|lelki|hit gyülekezete|hit gyulekezet|teológia|teologia)'
      THEN 'Religion & Spirituality'
      ELSE b.podcast_category
    END AS display_category,
    CASE
      WHEN b.podcast_category = 'Religion & Spirituality'
        OR b.hay ~ '(zarándok|zarandok|igehirdet|istentisztelet|biblia|evangélium|evangelium|katolikus|református|reformatus|keresztény|kereszteny|egyházi|egyhazi|prédikáció|predikacio|ima|imádság|imadsag|lelki|hit gyülekezete|hit gyulekezet|teológia|teologia)'
      THEN 'religion'
      WHEN b.podcast_category = 'News & Politics' THEN 'news'
      WHEN b.podcast_category IN ('Business & Finance', 'Finance') THEN 'business_finance'
      WHEN b.podcast_category IN ('Society & Culture', 'Film, TV & Pop Culture', 'Arts', 'Music') THEN 'culture'
      WHEN b.podcast_category IN ('Psychology & Relationships', 'Relationships', 'Self-Improvement') THEN 'self_relationships'
      ELSE coalesce(b.podcast_category, 'other')
    END AS category_group,
    (
      CASE b.rank_label
        WHEN 'S' THEN 88
        WHEN 'A' THEN 66
        WHEN 'B' THEN 42
        WHEN 'C' THEN 24
        WHEN 'D' THEN 10
        WHEN 'E' THEN 6
        ELSE 12
      END
      + CASE WHEN b.featured THEN 18 ELSE 0 END
      + CASE
          WHEN b.published_at >= now() - interval '24 hours' THEN 22
          WHEN b.published_at >= now() - interval '7 days' THEN 14
          WHEN b.published_at >= now() - interval '14 days' THEN 7
          ELSE 0
        END
      + CASE WHEN b.clean_text_status = 'done' THEN 8 ELSE 0 END
      + CASE WHEN b.cleaner_method = 'deterministic_v4' THEN 4 ELSE 0 END
      + CASE WHEN b.text_source_confidence >= 0.85 THEN 8 WHEN b.text_source_confidence >= 0.70 THEN 4 ELSE 0 END
      + CASE WHEN length(coalesce(b.ai_summary, '')) >= 90 THEN 7 ELSE 0 END
      + CASE
          WHEN b.clean_text_len BETWEEN 240 AND 8000 THEN 7
          WHEN b.clean_text_len BETWEEN 120 AND 12000 THEN 3
          ELSE -8
        END
      + least(cardinality(coalesce(b.topics, '{}'::text[])), 5) * 2
      + least(cardinality(coalesce(b.people, '{}'::text[])), 3) * 2
      + least(cardinality(coalesce(b.companies, '{}'::text[])), 2) * 2
      - CASE
          WHEN b.hay ~ '(hírek|hirek|h.r|h.r-.sszefoglal.|napi h.r|esti h.r|reggeli h.r|krónika|kronika|infostart|h.rpercek|h.rm.sor|összes hír|osszes hir)' THEN 44
          ELSE 0
        END
      - CASE
          WHEN lower(coalesce(b.display_title, b.title, '')) ~ '(^[[:space:]]*[0-9]{1,2}[[:space:]]*[-–—][[:space:]]+.|^[[:space:]]*20[0-9]{6}([[:space:]]|[-–—])|^[[:space:]]*[0-9]{1,2}[[:space:]]+(óra|ora|perc)($|[[:space:]])|hírek röviden|hirek roviden|percben|perc h.r)' THEN 80
          ELSE 0
        END
    ) AS homepage_score,
    (
      cardinality(coalesce(b.topics, '{}'::text[]))
      + cardinality(coalesce(b.people, '{}'::text[]))
      + cardinality(coalesce(b.companies, '{}'::text[]))
      + CASE WHEN jsonb_typeof(b.organizations) = 'array' THEN jsonb_array_length(b.organizations) ELSE 0 END
    ) AS entity_signal_count
  FROM feed_base b
),
latest_chart_snap AS (
  SELECT source, max(snapshot_at) AS snap
  FROM public.podcast_charts
  WHERE country = 'hu'
    AND snapshot_at > now() - interval '7 days'
  GROUP BY source
),
market_podcasts AS (
  SELECT
    c.podcast_id,
    count(DISTINCT c.source)::int AS market_source_count,
    min(c.rank)::int AS market_best_rank,
    sum(1.0 / (60.0 + c.rank))::numeric AS market_rrf
  FROM (
    SELECT DISTINCT ON (pc.podcast_id, pc.source)
      pc.podcast_id,
      pc.source,
      pc.rank
    FROM public.podcast_charts pc
    JOIN latest_chart_snap ls ON ls.source = pc.source AND ls.snap = pc.snapshot_at
    WHERE pc.podcast_id IS NOT NULL
    ORDER BY pc.podcast_id, pc.source, pc.rank ASC
  ) c
  GROUP BY c.podcast_id
),
editorial_pool AS (
  SELECT
    s.*,
    coalesce(mp.market_source_count, 0) AS market_source_count,
    mp.market_best_rank,
    coalesce(mp.market_rrf, 0) AS market_rrf,
    row_number() OVER (
      PARTITION BY s.podcast_id
      ORDER BY s.homepage_score DESC, s.published_at DESC NULLS LAST
    ) AS podcast_pick_rank
  FROM scored s
  LEFT JOIN market_podcasts mp ON mp.podcast_id = s.podcast_id
  WHERE s.freshness_bucket IN ('hot', 'fresh')
     OR s.published_at >= now() - interval '30 days'
),
editorial_capped AS (
  SELECT
    t.*,
    sum(CASE WHEN t.news_like THEN 1 ELSE 0 END) OVER (
      ORDER BY t.homepage_score DESC, t.published_at DESC NULLS LAST
    ) AS news_pick_rank,
    sum(CASE WHEN t.bulletin_like THEN 1 ELSE 0 END) OVER (
      ORDER BY t.homepage_score DESC, t.published_at DESC NULLS LAST
    ) AS bulletin_pick_rank
  FROM editorial_pool t
),
slot_popular AS (
  SELECT *, 1 AS slot_priority, 'popular_fresh'::text AS editorial_slot
  FROM editorial_capped
  WHERE podcast_pick_rank = 1
    AND coalesce(market_source_count, 0) > 0
    AND published_at >= now() - interval '21 days'
    AND NOT bulletin_like
  ORDER BY market_source_count DESC, market_rrf DESC, homepage_score DESC, published_at DESC NULLS LAST
  LIMIT 3
),
slot_quality AS (
  SELECT *, 2 AS slot_priority, 'content_quality'::text AS editorial_slot
  FROM editorial_capped c
  WHERE podcast_pick_rank = 1
    AND homepage_score >= 70
    AND NOT bulletin_like
    AND NOT EXISTS (SELECT 1 FROM slot_popular x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id)
  ORDER BY homepage_score DESC, published_at DESC NULLS LAST
  LIMIT 3
),
slot_deep AS (
  SELECT *, 3 AS slot_priority, 'deep_pick'::text AS editorial_slot
  FROM editorial_capped c
  WHERE podcast_pick_rank = 1
    AND coalesce(clean_text_len, 0) >= 500
    AND NOT news_like
    AND NOT bulletin_like
    AND NOT EXISTS (
      SELECT 1 FROM slot_popular x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id
      UNION ALL
      SELECT 1 FROM slot_quality x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id
    )
  ORDER BY homepage_score DESC, published_at DESC NULLS LAST
  LIMIT 1
),
slot_discovery AS (
  SELECT *, 4 AS slot_priority, 'discovery'::text AS editorial_slot
  FROM editorial_capped c
  WHERE podcast_pick_rank = 1
    AND coalesce(market_source_count, 0) = 0
    AND coalesce(podiverzum_rank, 0) < 6.4
    AND NOT news_like
    AND NOT bulletin_like
    AND NOT EXISTS (
      SELECT 1 FROM slot_popular x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id
      UNION ALL
      SELECT 1 FROM slot_quality x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id
      UNION ALL
      SELECT 1 FROM slot_deep x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id
    )
  ORDER BY homepage_score DESC, published_at DESC NULLS LAST
  LIMIT 1
),
editorial_primary AS (
  SELECT * FROM slot_popular
  UNION ALL
  SELECT * FROM slot_quality
  UNION ALL
  SELECT * FROM slot_deep
  UNION ALL
  SELECT * FROM slot_discovery
),
editorial_primary_dedup AS (
  SELECT *
  FROM (
    SELECT
      ep.*,
      row_number() OVER (PARTITION BY ep.episode_id ORDER BY ep.slot_priority ASC, ep.homepage_score DESC) AS episode_slot_rank,
      row_number() OVER (PARTITION BY ep.podcast_id ORDER BY ep.slot_priority ASC, ep.homepage_score DESC) AS podcast_slot_rank
    FROM editorial_primary ep
  ) x
  WHERE episode_slot_rank = 1
    AND podcast_slot_rank = 1
),
editorial_backfill AS (
  SELECT
    c.*,
    9 AS slot_priority,
    'balanced_backfill'::text AS editorial_slot,
    NULL::bigint AS episode_slot_rank,
    NULL::bigint AS podcast_slot_rank
  FROM editorial_capped c
  WHERE c.podcast_pick_rank <= 2
    AND NOT c.bulletin_like
    AND (NOT c.news_like OR coalesce(c.news_pick_rank, 0) <= 1)
    AND NOT EXISTS (
      SELECT 1 FROM editorial_primary_dedup p
      WHERE p.episode_id = c.episode_id OR p.podcast_id = c.podcast_id
    )
  ORDER BY c.podcast_pick_rank ASC, c.homepage_score DESC, c.published_at DESC NULLS LAST
  LIMIT greatest(_trending_limit - (SELECT count(*)::integer FROM editorial_primary_dedup), 0)
),
trending_candidates AS (
  SELECT * FROM editorial_primary_dedup
  UNION ALL
  SELECT * FROM editorial_backfill
),
trending AS (
  SELECT *
  FROM (
    SELECT
      tc.*,
      row_number() OVER (
        PARTITION BY tc.category_group
        ORDER BY tc.slot_priority ASC, tc.homepage_score DESC, tc.published_at DESC NULLS LAST
      ) AS category_group_rank,
      row_number() OVER (
        PARTITION BY tc.podcast_id
        ORDER BY tc.slot_priority ASC, tc.homepage_score DESC, tc.published_at DESC NULLS LAST
      ) AS final_podcast_rank
    FROM trending_candidates tc
  ) x
  WHERE x.category_group_rank <= 2
    AND x.final_podcast_rank <= 2
  ORDER BY x.slot_priority ASC, x.homepage_score DESC, x.published_at DESC NULLS LAST
  LIMIT _trending_limit
),
category_names AS (
  SELECT
    c.name,
    c.slug,
    coalesce(c.taxonomy_keys, ARRAY[c.name]) AS taxonomy_keys,
    c.sort_order
  FROM public.categories c
  WHERE EXISTS (
    SELECT 1
    FROM scored s
    WHERE s.display_category = ANY(coalesce(c.taxonomy_keys, ARRAY[c.name]))
  )
  ORDER BY c.sort_order NULLS LAST, c.name
  LIMIT _max_categories
),
category_ranked AS (
  SELECT
    c.name AS homepage_category,
    c.slug AS homepage_category_slug,
    s.*,
    row_number() OVER (
      PARTITION BY c.slug, s.podcast_id
      ORDER BY s.homepage_score DESC, s.published_at DESC NULLS LAST
    ) AS category_podcast_rank
  FROM category_names c
  JOIN scored s ON s.display_category = ANY(c.taxonomy_keys)
  WHERE NOT s.bulletin_like
),
category_limited AS (
  SELECT *
  FROM (
    SELECT
      cr.*,
      row_number() OVER (
        PARTITION BY cr.homepage_category_slug
        ORDER BY cr.category_podcast_rank ASC, cr.homepage_score DESC, cr.published_at DESC NULLS LAST
      ) AS category_rank
    FROM category_ranked cr
    WHERE cr.category_podcast_rank <= 1
  ) x
  WHERE x.category_rank <= _category_limit
),
evergreen AS (
  SELECT
    e.*,
    ep.people,
    ep.companies,
    ep.organizations,
    ep.clean_text_status,
    ebts.source_confidence,
    lower(concat_ws(' ', e.podcast_category, e.podcast_title, e.podcast_display_title, e.title, e.display_title)) AS hay,
    (
      coalesce(e.podiverzum_rank, 0) * 10
      + CASE WHEN ep.clean_text_status = 'done' THEN 8 ELSE 0 END
      + CASE WHEN length(coalesce(e.ai_summary, '')) >= 90 THEN 10 ELSE 0 END
      + CASE WHEN coalesce(ebts.source_confidence, 0) >= 0.8 THEN 6 ELSE 0 END
      + least(cardinality(coalesce(e.topics, '{}'::text[])), 5) * 2
      + least(cardinality(coalesce(ep.people, '{}'::text[])), 3) * 2
      + least(cardinality(coalesce(ep.companies, '{}'::text[])), 2) * 2
    ) AS evergreen_score
  FROM public.mv_homepage_evergreen e
  JOIN public.episodes ep ON ep.id = e.episode_id
  JOIN public.podcasts p ON p.id = e.podcast_id
  LEFT JOIN public.episode_best_text_source ebts ON ebts.episode_id = e.episode_id
  WHERE e.audio_url IS NOT NULL
    AND (COALESCE(p.is_hungarian, false) = true OR p.language_decision = 'accept_hungarian')
    AND COALESCE(p.language_decision, 'accept_hungarian') NOT IN ('reject_foreign', 'confirmed_foreign', 'reject_non_hungarian')
    AND COALESCE(p.rss_status, '') NOT IN ('failed', 'inactive', 'deleted')
    AND lower(concat_ws(' ', e.podcast_category, e.podcast_title, e.podcast_display_title, e.title, e.display_title)) !~ '(hírek|hirek|infostart|összes hír|osszes hir)'
  ORDER BY evergreen_score DESC, e.published_at DESC NULLS LAST
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
        'podcast_category', display_category,
        'category_group', category_group,
        'podiverzum_rank', podiverzum_rank,
        'rank_label', rank_label,
        'rss_status', rss_status,
        'featured', featured,
        'featured_rank', featured_rank,
        'pod_rank', pod_rank,
        'freshness_bucket', freshness_bucket,
        'homepage_score', homepage_score,
        'editorial_slot', editorial_slot,
        'market_source_count', market_source_count,
        'market_best_rank', market_best_rank
      )
      ORDER BY slot_priority ASC, homepage_score DESC, published_at DESC NULLS LAST
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
        'pod_rank', pod_rank,
        'homepage_score', evergreen_score
      )
      ORDER BY evergreen_score DESC, published_at DESC NULLS LAST
    ),
    '[]'::jsonb
  ) AS items
  FROM evergreen
),
category_json AS (
  SELECT coalesce(jsonb_object_agg(homepage_category, items), '{}'::jsonb) AS items
  FROM (
    SELECT
      homepage_category,
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
          'podcast_category', display_category,
          'podiverzum_rank', podiverzum_rank,
          'rank_label', rank_label,
          'rss_status', rss_status,
          'featured', featured,
          'featured_rank', featured_rank,
          'pod_rank', pod_rank,
          'freshness_bucket', freshness_bucket,
          'homepage_score', homepage_score
        )
        ORDER BY category_rank ASC
      ) AS items
    FROM category_limited
    GROUP BY homepage_category
  ) per_category
)
SELECT jsonb_build_object(
  'policy', jsonb_build_object(
    'version', 'press_homepage_hu_consumer_guard_v1',
    'admission_rule', 'Hungarian, non-spam, playable podcasts only; featured cannot bypass language rejection',
    'editorial_slots', jsonb_build_object(
      'popular_fresh', 3,
      'content_quality', 3,
      'deep_pick', 1,
      'discovery', 1,
      'balanced_backfill', 'fills remaining slots with a hard bulletin ban and max one news-like episode'
    ),
    'removed_consumer_surface', jsonb_build_array('current_entities'),
    'uses_clean_text', true,
    'uses_best_text_source', true,
    'uses_entity_evidence', true
  ),
  'trending', (SELECT items FROM trending_json),
  'evergreen', (SELECT items FROM evergreen_json),
  'categories', (SELECT items FROM category_json)
);
$$;

GRANT EXECUTE ON FUNCTION public.get_homepage_rails_v1(integer, integer, integer, integer) TO anon, authenticated;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'homepage_quality_policy',
  jsonb_build_object(
    'version', 'press_homepage_hu_consumer_guard_v1',
    'admission_rule', 'Hungarian non-spam playable podcasts only; featured cannot bypass language rejection',
    'rank_role', 'ordering signal only',
    'consumer_surface', 'no B2B/entity-monitoring editorial slot on homepage',
    'news_policy', 'bulletins excluded from top rails; at most one news-like backfill item',
    'quality_inputs', jsonb_build_array(
      'clean_text_status',
      'episode_clean_text.cleaner_method',
      'episode_best_text_source.source_confidence',
      'ai_summary',
      'topics',
      'people',
      'companies',
      'organizations'
    )
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
