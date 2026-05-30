WITH religious_candidates AS (
  SELECT id, category AS old_category
  FROM public.podcasts
  WHERE COALESCE(is_hungarian, false) = true
    AND COALESCE(rss_status, '') NOT IN ('failed', 'inactive', 'deleted')
    AND COALESCE(category, '') <> 'Religion & Spirituality'
    AND lower(concat_ws(' ', title, display_title, description, website_url, rss_url)) ~
      '(zarándok|zarandok|igehirdet|istentisztelet|biblia|evangélium|evangelium|katolikus|református|reformatus|keresztény|kereszteny|egyházi|egyhazi|prédikáció|predikacio|ima|imádság|imadsag|lelki|hit gyülekezete|hit gyulekezet|teológia|teologia)'
)
UPDATE public.podcasts p
SET category = 'Religion & Spirituality',
    ai_category_alt = COALESCE(p.ai_category_alt, p.category),
    ai_category_confidence = GREATEST(COALESCE(p.ai_category_confidence, 0), 0.86),
    ai_category_needs_review = false,
    ai_category_model = COALESCE(p.ai_category_model, 'deterministic-religion-v1'),
    ai_category_at = now(),
    shadow_rank_components = COALESCE(p.shadow_rank_components, '{}'::jsonb)
      || jsonb_build_object(
        'category_repair',
        jsonb_build_object(
          'version', 'deterministic_religion_v1',
          'old_category', rc.old_category,
          'reason', 'religious keyword/category repair'
        )
      )
FROM religious_candidates rc
WHERE p.id = rc.id;

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
    lower(concat_ws(
      ' ',
      f.podcast_category,
      f.podcast_title,
      f.podcast_display_title,
      f.title,
      f.display_title
    )) AS hay
  FROM public.mv_homepage_feed f
  JOIN public.episodes ep ON ep.id = f.episode_id
  LEFT JOIN public.episode_clean_text ect ON ect.episode_id = f.episode_id
  LEFT JOIN public.episode_best_text_source ebts ON ebts.episode_id = f.episode_id
  WHERE f.pod_rank <= 6
    AND f.audio_url IS NOT NULL
),
scored AS (
  SELECT
    b.*,
    cardinality(coalesce(b.topics, '{}'::text[])) AS topic_count,
    cardinality(coalesce(b.people, '{}'::text[])) AS person_count,
    cardinality(coalesce(b.companies, '{}'::text[])) AS company_count,
    CASE
      WHEN jsonb_typeof(b.organizations) = 'array' THEN jsonb_array_length(b.organizations)
      ELSE 0
    END AS organization_count,
    (
      CASE WHEN b.clean_text_status = 'done' THEN 8 ELSE 0 END
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
      + CASE
          WHEN jsonb_typeof(b.organizations) = 'array'
          THEN least(jsonb_array_length(b.organizations), 2) * 2
          ELSE 0
        END
      + CASE WHEN b.entity_extraction_evidence IS NOT NULL AND b.entity_extraction_evidence <> '{}'::jsonb THEN 4 ELSE 0 END
    ) AS content_quality_score,
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
          WHEN b.featured AND b.featured_rank IS NOT NULL
          THEN greatest(0, 10 - least(10, b.featured_rank))
          ELSE 0
        END
      + least(greatest(coalesce(b.podiverzum_rank, 0), 0), 10) * 2
      + CASE
          WHEN b.published_at >= now() - interval '24 hours' THEN 26
          WHEN b.published_at >= now() - interval '7 days' THEN 16
          WHEN b.published_at >= now() - interval '14 days' THEN 8
          ELSE 0
        END
      - CASE
          WHEN b.hay ~ '(hirek|h.r|h.r-.sszefoglal.|napi h.r|esti h.r|reggeli h.r|kronika|kr.nika|infostart|h.rpercek|h.rm.sor)' THEN 14
          ELSE 0
        END
      - CASE
          WHEN lower(coalesce(b.display_title, b.title, '')) ~ '(^[[:space:]]*[0-9]{1,2}[[:space:]]*[-–—][[:space:]]+.|^[[:space:]]*20[0-9]{6}([[:space:]]|[-–—])|^[[:space:]]*[0-9]{1,2}[[:space:]]+(ora|.ra|perc)($|[[:space:]])|hirek roviden|h.rek r.viden|percben|perc h.r)' THEN 38
          ELSE 0
        END
      - CASE
          WHEN b.clean_text_status IS DISTINCT FROM 'done'
            AND length(coalesce(b.ai_summary, b.summary, b.description, '')) < 140
          THEN 16
          ELSE 0
        END
    ) AS base_homepage_score,
    (b.hay ~ '(hirek|h.r|h.r-.sszefoglal.|napi h.r|esti h.r|reggeli h.r|kronika|kr.nika|infostart|h.rpercek|h.rm.sor)') AS news_like,
    (lower(coalesce(b.display_title, b.title, '')) ~ '(^[[:space:]]*[0-9]{1,2}[[:space:]]*[-–—][[:space:]]+.|^[[:space:]]*20[0-9]{6}([[:space:]]|[-–—])|^[[:space:]]*[0-9]{1,2}[[:space:]]+(ora|.ra|perc)($|[[:space:]])|hirek roviden|h.rek r.viden|percben|perc h.r)') AS bulletin_like
  FROM feed_base b
),
final_scored AS (
  SELECT
    s.*,
    CASE
      WHEN s.podcast_category = 'Religion & Spirituality'
        OR s.hay ~ '(zarándok|zarandok|igehirdet|istentisztelet|biblia|evangélium|evangelium|katolikus|református|reformatus|keresztény|kereszteny|egyházi|egyhazi|prédikáció|predikacio|ima|imádság|imadsag|lelki|hit gyülekezete|hit gyulekezet|teológia|teologia)'
      THEN 'Religion & Spirituality'
      ELSE s.podcast_category
    END AS display_category,
    CASE
      WHEN s.podcast_category = 'Religion & Spirituality'
        OR s.hay ~ '(zarándok|zarandok|igehirdet|istentisztelet|biblia|evangélium|evangelium|katolikus|református|reformatus|keresztény|kereszteny|egyházi|egyhazi|prédikáció|predikacio|ima|imádság|imadsag|lelki|hit gyülekezete|hit gyulekezet|teológia|teologia)'
      THEN 'religion'
      WHEN s.podcast_category = 'News & Politics' THEN 'news'
      WHEN s.podcast_category IN ('Business & Finance', 'Finance') THEN 'business_finance'
      WHEN s.podcast_category IN ('Society & Culture', 'Film, TV & Pop Culture', 'Arts', 'Music') THEN 'culture'
      WHEN s.podcast_category IN ('Psychology & Relationships', 'Relationships', 'Self-Improvement') THEN 'self_relationships'
      ELSE coalesce(s.podcast_category, 'other')
    END AS category_group,
    (s.base_homepage_score + s.content_quality_score) AS homepage_score
  FROM scored s
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
    (
      cardinality(coalesce(s.topics, '{}'::text[]))
      + cardinality(coalesce(s.people, '{}'::text[]))
      + cardinality(coalesce(s.companies, '{}'::text[]))
      + CASE WHEN jsonb_typeof(s.organizations) = 'array' THEN jsonb_array_length(s.organizations) ELSE 0 END
    ) AS entity_signal_count,
    row_number() OVER (
      PARTITION BY s.podcast_id
      ORDER BY s.homepage_score DESC, s.published_at DESC NULLS LAST
    ) AS podcast_pick_rank
  FROM final_scored s
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
  LIMIT 2
),
slot_quality AS (
  SELECT *, 2 AS slot_priority, 'content_quality'::text AS editorial_slot
  FROM editorial_capped c
  WHERE podcast_pick_rank = 1
    AND content_quality_score >= 22
    AND NOT bulletin_like
    AND NOT EXISTS (SELECT 1 FROM slot_popular x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id)
  ORDER BY content_quality_score DESC, homepage_score DESC, published_at DESC NULLS LAST
  LIMIT 2
),
slot_entities AS (
  SELECT *, 3 AS slot_priority, 'current_entities'::text AS editorial_slot
  FROM editorial_capped c
  WHERE podcast_pick_rank = 1
    AND entity_signal_count >= 3
    AND NOT bulletin_like
    AND NOT EXISTS (
      SELECT 1 FROM slot_popular x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id
      UNION ALL
      SELECT 1 FROM slot_quality x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id
    )
  ORDER BY entity_signal_count DESC, homepage_score DESC, published_at DESC NULLS LAST
  LIMIT 2
),
slot_deep AS (
  SELECT *, 4 AS slot_priority, 'deep_pick'::text AS editorial_slot
  FROM editorial_capped c
  WHERE podcast_pick_rank = 1
    AND content_quality_score >= 16
    AND coalesce(clean_text_len, 0) >= 500
    AND NOT news_like
    AND NOT bulletin_like
    AND NOT EXISTS (
      SELECT 1 FROM slot_popular x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id
      UNION ALL
      SELECT 1 FROM slot_quality x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id
      UNION ALL
      SELECT 1 FROM slot_entities x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id
    )
  ORDER BY homepage_score DESC, published_at DESC NULLS LAST
  LIMIT 1
),
slot_discovery AS (
  SELECT *, 5 AS slot_priority, 'discovery'::text AS editorial_slot
  FROM editorial_capped c
  WHERE podcast_pick_rank = 1
    AND coalesce(market_source_count, 0) = 0
    AND coalesce(podiverzum_rank, 0) < 6.4
    AND content_quality_score >= 12
    AND NOT bulletin_like
    AND NOT EXISTS (
      SELECT 1 FROM slot_popular x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id
      UNION ALL
      SELECT 1 FROM slot_quality x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id
      UNION ALL
      SELECT 1 FROM slot_entities x WHERE x.episode_id = c.episode_id OR x.podcast_id = c.podcast_id
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
  SELECT * FROM slot_entities
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
      row_number() OVER (
        PARTITION BY ep.episode_id
        ORDER BY ep.slot_priority ASC, ep.homepage_score DESC
      ) AS episode_slot_rank,
      row_number() OVER (
        PARTITION BY ep.podcast_id
        ORDER BY ep.slot_priority ASC, ep.homepage_score DESC
      ) AS podcast_slot_rank
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
    AND (NOT c.news_like OR coalesce(c.news_pick_rank, 0) <= 2)
    AND (NOT c.bulletin_like OR coalesce(c.bulletin_pick_rank, 0) <= 1)
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
    FROM final_scored s
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
  JOIN final_scored s ON s.display_category = ANY(c.taxonomy_keys)
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
  LEFT JOIN public.episode_best_text_source ebts ON ebts.episode_id = e.episode_id
  WHERE e.audio_url IS NOT NULL
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
        'content_quality_score', content_quality_score,
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
  SELECT coalesce(
    jsonb_object_agg(homepage_category, items),
    '{}'::jsonb
  ) AS items
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
          'homepage_score', homepage_score,
          'content_quality_score', content_quality_score
        )
        ORDER BY category_rank ASC
      ) AS items
    FROM category_limited
    GROUP BY homepage_category
  ) per_category
)
SELECT jsonb_build_object(
  'policy', jsonb_build_object(
    'version', 'homepage_category_diversity_v4',
    'trending_primary_podcast_cap', 1,
    'editorial_slots', jsonb_build_object(
      'popular_fresh', 2,
      'content_quality', 2,
      'current_entities', 2,
      'deep_pick', 1,
      'discovery', 1,
      'balanced_backfill', 'fills remaining slots'
    ),
    'category_podcast_cap', 1,
    'trending_category_group_cap', 2,
    'category_repairs', jsonb_build_array('deterministic_religion_v1'),
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
    'version', 'homepage_category_diversity_v4',
    'rank_role', 'weak ordering signal, not admission gate',
    'quality_inputs', jsonb_build_array(
      'clean_text_status',
      'episode_clean_text.cleaner_method',
      'episode_best_text_source.source_confidence',
      'ai_summary',
      'topics',
      'people',
      'companies',
      'organizations',
      'entity_extraction_evidence'
    ),
    'diversity', jsonb_build_object(
      'trending_primary_max_per_podcast', 1,
      'category_max_per_podcast', 1,
      'trending_backfill_max_per_podcast', 2,
      'trending_max_per_category_group', 2
    ),
    'category_repairs', jsonb_build_array('deterministic_religion_v1'),
    'editorial_slots', jsonb_build_object(
      'popular_fresh', '2 fresh episodes from charted/toplist podcasts',
      'content_quality', '2 episodes with strong clean text, summary and entity signals',
      'current_entities', '2 episodes rich in people, companies, organizations or topics',
      'deep_pick', '1 longer, non-news, high-quality episode',
      'discovery', '1 smaller promising Hungarian podcast',
      'balanced_backfill', 'fills remaining slots with caps for news and bulletins'
    )
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
