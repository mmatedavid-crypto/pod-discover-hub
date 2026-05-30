-- External-demand golden queries for the search benchmark.
-- Until Podiverzum has enough user search volume, benchmark coverage should be
-- driven by market demand: Spotify/Apple chart signals, YouTube reach and a
-- manually curated Google/Trends-like Hungarian topic seed list.

CREATE TABLE IF NOT EXISTS public.search_external_demand_seeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL UNIQUE,
  query_type text NOT NULL DEFAULT 'external_demand',
  expected_intent text,
  expected_entity text,
  must_include jsonb NOT NULL DEFAULT '[]'::jsonb,
  must_exclude jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'manual',
  weight numeric NOT NULL DEFAULT 1,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.search_external_demand_seeds ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "external demand seeds public read"
    ON public.search_external_demand_seeds FOR SELECT
    TO public USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "external demand seeds admin write"
    ON public.search_external_demand_seeds FOR ALL
    TO public
    USING (public.has_role(auth.uid(), 'admin'::app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

WITH rows(query, query_type, expected_intent, expected_entity, must_include, source, weight, notes) AS (
  VALUES
    ('magyar péter', 'external_google_person', 'person', 'Magyar Péter', '["Magyar Péter"]'::jsonb, 'google_trends_manual_hu', 1.00, 'High-demand Hungarian public figure query.'),
    ('orbán viktor', 'external_google_person', 'person', 'Orbán Viktor', '["Orbán Viktor"]'::jsonb, 'google_trends_manual_hu', 1.00, 'High-demand Hungarian public figure query.'),
    ('tisza párt', 'external_google_org', 'company', 'TISZA Párt', '["TISZA"]'::jsonb, 'google_trends_manual_hu', 0.95, 'Political party / public affairs demand.'),
    ('fidesz', 'external_google_org', 'company', 'Fidesz', '["Fidesz"]'::jsonb, 'google_trends_manual_hu', 0.90, 'Political party demand.'),
    ('magyar telekom', 'external_google_brand', 'company', 'Magyar Telekom', '["Magyar Telekom"]'::jsonb, 'google_trends_manual_hu', 0.85, 'Brand/company demand.'),
    ('mtel', 'external_google_brand_alias', 'company', 'Magyar Telekom', '["Magyar Telekom"]'::jsonb, 'google_trends_manual_hu', 0.80, 'Ticker alias demand.'),
    ('otp', 'external_google_brand_alias', 'ticker', 'OTP Bank', '["OTP"]'::jsonb, 'google_trends_manual_hu', 0.90, 'Ticker/brand query.'),
    ('mol', 'external_google_brand_alias', 'ticker', 'MOL', '["MOL"]'::jsonb, 'google_trends_manual_hu', 0.85, 'Ticker/brand query.'),
    ('forint árfolyam', 'external_google_topic', 'question', NULL, '["forint"]'::jsonb, 'google_trends_manual_hu', 1.00, 'Economy demand.'),
    ('infláció', 'external_google_topic', 'topic', NULL, '["infláció"]'::jsonb, 'google_trends_manual_hu', 0.95, 'Economy demand.'),
    ('állampapír', 'external_google_topic', 'topic', NULL, '["állampapír"]'::jsonb, 'google_trends_manual_hu', 0.90, 'Personal finance demand.'),
    ('lakáshitel', 'external_google_topic', 'topic', NULL, '["hitel"]'::jsonb, 'google_trends_manual_hu', 0.85, 'Personal finance demand.'),
    ('mesterséges intelligencia', 'external_google_topic', 'topic', NULL, '["mesterséges intelligencia"]'::jsonb, 'google_trends_manual_hu', 1.00, 'Technology demand.'),
    ('chatgpt', 'external_google_topic', 'topic', NULL, '["ChatGPT"]'::jsonb, 'google_trends_manual_hu', 0.95, 'Technology demand.'),
    ('nvidia', 'external_google_brand', 'company', 'Nvidia', '["Nvidia"]'::jsonb, 'google_trends_manual_hu', 0.85, 'AI/stock/company demand.'),
    ('ukrajna háború', 'external_google_topic', 'news', NULL, '["Ukrajna"]'::jsonb, 'google_trends_manual_hu', 0.95, 'News/public affairs demand.'),
    ('klímaváltozás', 'external_google_topic', 'topic', NULL, '["klíma"]'::jsonb, 'google_trends_manual_hu', 0.75, 'Climate demand.'),
    ('szorongás', 'external_google_topic', 'topic', NULL, '["szorongás"]'::jsonb, 'google_trends_manual_hu', 0.90, 'Mental health demand.'),
    ('alvászavar', 'external_google_topic', 'topic', NULL, '["alvás"]'::jsonb, 'google_trends_manual_hu', 0.85, 'Health demand.'),
    ('gyereknevelés', 'external_google_topic', 'topic', NULL, '["gyerek"]'::jsonb, 'google_trends_manual_hu', 0.90, 'Family demand.'),
    ('válás gyerekkel', 'external_google_question', 'question', NULL, '["gyerek", "válás"]'::jsonb, 'google_trends_manual_hu', 0.75, 'Natural question/family demand.'),
    ('fogyás', 'external_google_topic', 'topic', NULL, '["fogyás"]'::jsonb, 'google_trends_manual_hu', 0.80, 'Health/lifestyle demand.'),
    ('futás', 'external_google_topic', 'topic', NULL, '["futás"]'::jsonb, 'google_trends_manual_hu', 0.70, 'Sport/lifestyle demand.'),
    ('forma 1', 'external_google_topic', 'topic', NULL, '["Forma 1"]'::jsonb, 'google_trends_manual_hu', 0.85, 'Sports demand.'),
    ('bitcoin', 'external_google_topic', 'topic', NULL, '["Bitcoin"]'::jsonb, 'google_trends_manual_hu', 0.85, 'Crypto/finance demand.')
)
INSERT INTO public.search_external_demand_seeds (
  query, query_type, expected_intent, expected_entity, must_include, source, weight, notes, active, updated_at
)
SELECT query, query_type, expected_intent, expected_entity, must_include, source, weight, notes, true, now()
FROM rows
ON CONFLICT (query) DO UPDATE
SET query_type = EXCLUDED.query_type,
    expected_intent = EXCLUDED.expected_intent,
    expected_entity = EXCLUDED.expected_entity,
    must_include = EXCLUDED.must_include,
    source = EXCLUDED.source,
    weight = EXCLUDED.weight,
    notes = EXCLUDED.notes,
    active = true,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.refresh_search_golden_queries_from_external_demand(
  p_chart_limit integer DEFAULT 80,
  p_seed_limit integer DEFAULT 80
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chart_limit integer := GREATEST(10, LEAST(200, COALESCE(p_chart_limit, 80)));
  v_seed_limit integer := GREATEST(0, LEAST(200, COALESCE(p_seed_limit, 80)));
  v_upserted integer := 0;
  v_chart_upserted integer := 0;
  v_seed_upserted integer := 0;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  WITH chart_signal AS (
    SELECT
      pc.podcast_id,
      min(pc.rank) AS best_chart_rank,
      count(DISTINCT lower(pc.source)) AS chart_sources,
      sum(1.0 / GREATEST(pc.rank, 1)) AS chart_score
    FROM public.podcast_charts pc
    WHERE pc.podcast_id IS NOT NULL
      AND (pc.country IS NULL OR upper(pc.country) = 'HU')
      AND pc.snapshot_at >= now() - interval '180 days'
    GROUP BY pc.podcast_id
  ), spotify_signal AS (
    SELECT
      ps.podcast_id,
      max(COALESCE(ps.followers, 0)) AS spotify_followers,
      max(COALESCE(ps.popularity, 0)) AS spotify_popularity
    FROM public.podcast_spotify_snapshots ps
    WHERE ps.podcast_id IS NOT NULL
      AND ps.snapshot_date >= current_date - 180
    GROUP BY ps.podcast_id
  ), youtube_signal AS (
    SELECT
      p.id AS podcast_id,
      max(COALESCE(ys.subscriber_count, 0)) AS youtube_subscribers,
      max(COALESCE(ys.view_count, 0)) AS youtube_views
    FROM public.podcasts p
    JOIN public.youtube_channel_stats ys ON ys.channel_id = p.youtube_channel_id
    WHERE p.youtube_channel_id IS NOT NULL
      AND ys.snapshot_at >= now() - interval '180 days'
    GROUP BY p.id
  ), ranked AS (
    SELECT
      p.id,
      p.slug,
      COALESCE(NULLIF(p.display_title, ''), p.title) AS title,
      (
        COALESCE(cs.chart_score, 0) * 800
        + COALESCE(cs.chart_sources, 0) * 25
        + CASE WHEN cs.best_chart_rank IS NOT NULL THEN GREATEST(0, 100 - cs.best_chart_rank) ELSE 0 END
        + LEAST(160, log(10, GREATEST(COALESCE(ss.spotify_followers, p.spotify_followers, 0), 0) + 1) * 35)
        + COALESCE(ss.spotify_popularity, p.spotify_popularity, 0) * 1.2
        + LEAST(180, log(10, GREATEST(COALESCE(ys.youtube_subscribers, 0), 0) + 1) * 38)
        + LEAST(120, log(10, GREATEST(COALESCE(ys.youtube_views, 0), 0) + 1) * 18)
        + COALESCE(p.hu_content_intelligence_v2, p.shadow_rank, p.podiverzum_rank, 0) * 0.15
      )::numeric AS demand_score,
      cs.best_chart_rank,
      cs.chart_sources,
      COALESCE(ss.spotify_followers, p.spotify_followers, 0) AS spotify_followers,
      COALESCE(ss.spotify_popularity, p.spotify_popularity, 0) AS spotify_popularity,
      COALESCE(ys.youtube_subscribers, 0) AS youtube_subscribers
    FROM public.podcasts p
    LEFT JOIN chart_signal cs ON cs.podcast_id = p.id
    LEFT JOIN spotify_signal ss ON ss.podcast_id = p.id
    LEFT JOIN youtube_signal ys ON ys.podcast_id = p.id
    WHERE (p.is_hungarian IS TRUE OR p.language ILIKE 'hu%')
      AND (p.rss_status IS NULL OR p.rss_status NOT IN ('failed','inactive'))
      AND p.slug IS NOT NULL
      AND length(COALESCE(NULLIF(p.display_title, ''), p.title)) BETWEEN 2 AND 120
      AND (
        cs.podcast_id IS NOT NULL
        OR COALESCE(ss.spotify_followers, p.spotify_followers, 0) > 0
        OR COALESCE(ss.spotify_popularity, p.spotify_popularity, 0) > 0
        OR COALESCE(ys.youtube_subscribers, 0) > 0
      )
    ORDER BY demand_score DESC NULLS LAST, title
    LIMIT v_chart_limit
  ), ins AS (
    INSERT INTO public.search_golden_queries (
      query, query_type, expected_intent, expected_podcast_slug, expected_entity,
      must_include, must_exclude, notes, active, sort_order, updated_at
    )
    SELECT
      title,
      'podcast_title_external_demand',
      NULL,
      slug,
      NULL,
      jsonb_build_array(title),
      '[]'::jsonb,
      format(
        'Auto external demand: score=%s chart_rank=%s chart_sources=%s spotify_followers=%s spotify_popularity=%s youtube_subscribers=%s',
        round(demand_score, 2), best_chart_rank, chart_sources, spotify_followers, spotify_popularity, youtube_subscribers
      ),
      true,
      2500 + row_number() OVER (ORDER BY demand_score DESC NULLS LAST, title),
      now()
    FROM ranked
    ON CONFLICT (query) DO UPDATE
    SET query_type = EXCLUDED.query_type,
        expected_podcast_slug = EXCLUDED.expected_podcast_slug,
        must_include = EXCLUDED.must_include,
        notes = EXCLUDED.notes,
        active = true,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_chart_upserted FROM ins;

  WITH rows AS (
    SELECT
      s.query,
      s.query_type,
      s.expected_intent,
      NULL::text AS expected_podcast_slug,
      s.expected_entity,
      s.must_include,
      s.must_exclude,
      format('Auto external demand seed: source=%s weight=%s. %s', s.source, s.weight, COALESCE(s.notes, '')) AS notes,
      8000 + row_number() OVER (ORDER BY s.weight DESC, s.query) AS sort_order
    FROM public.search_external_demand_seeds s
    WHERE s.active IS TRUE
    ORDER BY s.weight DESC, s.query
    LIMIT v_seed_limit
  ), ins AS (
    INSERT INTO public.search_golden_queries (
      query, query_type, expected_intent, expected_podcast_slug, expected_entity,
      must_include, must_exclude, notes, active, sort_order, updated_at
    )
    SELECT query, query_type, expected_intent, expected_podcast_slug, expected_entity,
      must_include, must_exclude, notes, true, sort_order, now()
    FROM rows
    ON CONFLICT (query) DO UPDATE
    SET query_type = EXCLUDED.query_type,
        expected_intent = EXCLUDED.expected_intent,
        expected_entity = EXCLUDED.expected_entity,
        must_include = EXCLUDED.must_include,
        must_exclude = EXCLUDED.must_exclude,
        notes = EXCLUDED.notes,
        active = true,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_seed_upserted FROM ins;

  v_upserted := v_chart_upserted + v_seed_upserted;

  RETURN jsonb_build_object(
    'ok', true,
    'upserted', v_upserted,
    'chart_upserted', v_chart_upserted,
    'seed_upserted', v_seed_upserted,
    'chart_limit', v_chart_limit,
    'seed_limit', v_seed_limit,
    'refreshed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_search_golden_queries_from_external_demand(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_search_golden_queries_from_external_demand(integer, integer) TO authenticated, service_role;
