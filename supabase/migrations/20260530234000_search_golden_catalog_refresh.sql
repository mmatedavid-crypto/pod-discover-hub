-- Refresh benchmark golden queries from the live catalog and search demand.
-- Goal: benchmark the things users are likely to search for, not only a fixed
-- hand-written set.

CREATE OR REPLACE FUNCTION public.refresh_search_golden_queries_from_catalog(
  p_limit_per_type integer DEFAULT 40,
  p_popular_limit integer DEFAULT 40
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(5, LEAST(100, COALESCE(p_limit_per_type, 40)));
  v_popular_limit integer := GREATEST(0, LEAST(100, COALESCE(p_popular_limit, 40)));
  v_inserted integer := 0;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  WITH rows AS (
    SELECT
      COALESCE(NULLIF(p.display_title, ''), p.title) AS query,
      'podcast_title'::text AS query_type,
      NULL::text AS expected_intent,
      p.slug AS expected_podcast_slug,
      NULL::text AS expected_entity,
      jsonb_build_array(COALESCE(NULLIF(p.display_title, ''), p.title)) AS must_include,
      '[]'::jsonb AS must_exclude,
      'Auto: high-value podcast title from catalog.'::text AS notes,
      3000 + row_number() OVER (ORDER BY COALESCE(p.hu_content_intelligence_v2, p.podiverzum_rank, 0) DESC NULLS LAST, p.title) AS sort_order
    FROM public.podcasts p
    WHERE (p.is_hungarian IS TRUE OR p.language ILIKE 'hu%')
      AND (p.rss_status IS NULL OR p.rss_status NOT IN ('failed','inactive'))
      AND p.slug IS NOT NULL
      AND length(COALESCE(NULLIF(p.display_title, ''), p.title)) BETWEEN 2 AND 120
    ORDER BY COALESCE(p.hu_content_intelligence_v2, p.podiverzum_rank, 0) DESC NULLS LAST, p.title
    LIMIT v_limit
  ), ins AS (
    INSERT INTO public.search_golden_queries (
      query, query_type, expected_intent, expected_podcast_slug, expected_entity,
      must_include, must_exclude, notes, active, sort_order, updated_at
    )
    SELECT query, query_type, expected_intent, expected_podcast_slug, expected_entity,
      must_include, must_exclude, notes, true, sort_order, now()
    FROM rows
    WHERE query IS NOT NULL
    ON CONFLICT (query) DO UPDATE
    SET query_type = EXCLUDED.query_type,
        expected_intent = EXCLUDED.expected_intent,
        expected_podcast_slug = EXCLUDED.expected_podcast_slug,
        expected_entity = EXCLUDED.expected_entity,
        must_include = EXCLUDED.must_include,
        must_exclude = EXCLUDED.must_exclude,
        notes = EXCLUDED.notes,
        active = true,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  WITH rows AS (
    SELECT
      pe.name AS query,
      'person'::text AS query_type,
      'person'::text AS expected_intent,
      NULL::text AS expected_podcast_slug,
      pe.name AS expected_entity,
      jsonb_build_array(pe.name) AS must_include,
      '[]'::jsonb AS must_exclude,
      'Auto: public person page with podcast evidence.'::text AS notes,
      4000 + row_number() OVER (ORDER BY COALESCE(pe.gated_episode_count, pe.episode_count, 0) DESC, pe.name) AS sort_order
    FROM public.people pe
    WHERE pe.is_public IS TRUE
      AND pe.slug IS NOT NULL
      AND COALESCE(pe.gated_episode_count, pe.episode_count, 0) > 0
      AND length(pe.name) BETWEEN 3 AND 120
    ORDER BY COALESCE(pe.gated_episode_count, pe.episode_count, 0) DESC, pe.name
    LIMIT v_limit
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
        notes = EXCLUDED.notes,
        active = true,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
    RETURNING 1
  )
  SELECT v_inserted + count(*) INTO v_inserted FROM ins;

  WITH base_orgs AS (
    SELECT o.*
    FROM public.organizations o
    WHERE (o.is_public IS TRUE OR o.is_indexable IS TRUE)
      AND o.slug IS NOT NULL
      AND COALESCE(o.gated_episode_count, o.episode_count, 0) > 0
      AND length(o.name) BETWEEN 2 AND 120
    ORDER BY COALESCE(o.gated_episode_count, o.episode_count, 0) DESC, o.name
    LIMIT v_limit
  ), rows AS (
    SELECT
      o.name AS query,
      'company_brand'::text AS query_type,
      'company'::text AS expected_intent,
      NULL::text AS expected_podcast_slug,
      o.name AS expected_entity,
      jsonb_build_array(o.name) AS must_include,
      '[]'::jsonb AS must_exclude,
      'Auto: organization/company canonical name.'::text AS notes,
      5000 + row_number() OVER (ORDER BY COALESCE(o.gated_episode_count, o.episode_count, 0) DESC, o.name) AS sort_order
    FROM base_orgs o
    UNION ALL
    SELECT
      a.alias AS query,
      'company_brand_alias'::text AS query_type,
      'company'::text AS expected_intent,
      NULL::text AS expected_podcast_slug,
      o.name AS expected_entity,
      jsonb_build_array(o.name) AS must_include,
      '[]'::jsonb AS must_exclude,
      'Auto: organization/company alias.'::text AS notes,
      5200 + row_number() OVER (ORDER BY COALESCE(o.gated_episode_count, o.episode_count, 0) DESC, a.alias) AS sort_order
    FROM base_orgs o
    JOIN public.organization_aliases a ON a.organization_id = o.id
    WHERE a.status = 'accepted'
      AND COALESCE(a.confidence, 0) >= 0.6
      AND length(a.alias) BETWEEN 2 AND 80
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
        notes = EXCLUDED.notes,
        active = true,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
    RETURNING 1
  )
  SELECT v_inserted + count(*) INTO v_inserted FROM ins;

  WITH rows AS (
    SELECT
      t.name AS query,
      'topic'::text AS query_type,
      'topic'::text AS expected_intent,
      NULL::text AS expected_podcast_slug,
      t.name AS expected_entity,
      jsonb_build_array(t.name) AS must_include,
      '[]'::jsonb AS must_exclude,
      'Auto: public topic page.'::text AS notes,
      6000 + row_number() OVER (ORDER BY COALESCE(t.episode_count, 0) DESC, t.name) AS sort_order
    FROM public.topics t
    WHERE t.is_public IS TRUE
      AND t.slug IS NOT NULL
      AND COALESCE(t.episode_count, 0) > 0
      AND length(t.name) BETWEEN 2 AND 120
    ORDER BY COALESCE(t.episode_count, 0) DESC, t.name
    LIMIT v_limit
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
        notes = EXCLUDED.notes,
        active = true,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
    RETURNING 1
  )
  SELECT v_inserted + count(*) INTO v_inserted FROM ins;

  WITH popular AS (
    SELECT
      btrim(query) AS query,
      count(*) AS n,
      avg(result_count)::numeric AS avg_results,
      sum(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) AS zero_n
    FROM public.search_events
    WHERE created_at >= now() - interval '30 days'
      AND length(btrim(query)) BETWEEN 3 AND 120
    GROUP BY btrim(query)
    ORDER BY count(*) DESC, sum(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) DESC
    LIMIT v_popular_limit
  ), rows AS (
    SELECT
      query,
      'popular_live'::text AS query_type,
      NULL::text AS expected_intent,
      NULL::text AS expected_podcast_slug,
      NULL::text AS expected_entity,
      '[]'::jsonb AS must_include,
      '[]'::jsonb AS must_exclude,
      format('Auto: popular live query in last 30d. searches=%s avg_results=%s zero=%s', n, round(avg_results, 2), zero_n)::text AS notes,
      7000 + row_number() OVER (ORDER BY n DESC, zero_n DESC, query) AS sort_order
    FROM popular
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
        expected_podcast_slug = EXCLUDED.expected_podcast_slug,
        expected_entity = EXCLUDED.expected_entity,
        must_include = EXCLUDED.must_include,
        must_exclude = EXCLUDED.must_exclude,
        notes = EXCLUDED.notes,
        active = true,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
    RETURNING 1
  )
  SELECT v_inserted + count(*) INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'ok', true,
    'upserted', v_inserted,
    'limit_per_type', v_limit,
    'popular_limit', v_popular_limit,
    'refreshed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_search_golden_queries_from_catalog(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_search_golden_queries_from_catalog(integer, integer) TO authenticated, service_role;
