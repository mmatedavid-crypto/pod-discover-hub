CREATE OR REPLACE FUNCTION public.list_sitemap_podcast_annual_archives_json_v1(
  p_min_episodes integer DEFAULT 3,
  p_page_size integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '20s'
AS $$
  WITH agg AS (
    SELECT
      p.slug AS podcast_slug,
      EXTRACT(YEAR FROM e.published_at AT TIME ZONE 'UTC')::int AS year,
      COUNT(*)::bigint AS episode_count,
      CEIL(COUNT(*)::numeric / GREATEST(1, LEAST(COALESCE(p_page_size, 100), 100))::numeric)::int AS total_pages,
      MAX(GREATEST(COALESCE(e.updated_at, e.published_at), e.published_at)) AS lastmod
    FROM public.podcasts p
    JOIN public.episodes e ON e.podcast_id = p.id
    WHERE p.language_decision = 'accept_hungarian'
      AND COALESCE(p.rss_status, '') <> 'inactive'
      AND p.slug IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.podcast_canonical_mappings m
        WHERE m.alias_podcast_id = p.id AND m.status = 'active'
      )
      AND e.published_at IS NOT NULL
      AND e.published_at <= now()
      AND e.is_prefetch_placeholder IS NOT TRUE
      AND EXTRACT(YEAR FROM e.published_at AT TIME ZONE 'UTC') BETWEEN 2000 AND 2100
      AND NOT EXISTS (
        SELECT 1 FROM public.episode_ingest_exclusions ex
        WHERE ex.podcast_id = e.podcast_id
          AND (
            (ex.guid IS NOT NULL AND e.guid = ex.guid)
            OR (ex.old_slug IS NOT NULL AND e.slug = ex.old_slug)
            OR (ex.asset_id IS NOT NULL AND (
              COALESCE(e.audio_url, '') ILIKE '%' || ex.asset_id || '%'
              OR COALESCE(e.episode_url, '') ILIKE '%' || ex.asset_id || '%'
              OR COALESCE(e.youtube_video_id, '') = ex.asset_id
            ))
          )
      )
    GROUP BY p.id, p.slug, EXTRACT(YEAR FROM e.published_at AT TIME ZONE 'UTC')::int
    HAVING COUNT(*) >= GREATEST(1, COALESCE(p_min_episodes, 3))
  )
  SELECT jsonb_build_object(
    'show_year_count', (SELECT COUNT(*)::int FROM agg),
    'total_url_count', COALESCE((SELECT SUM(total_pages)::int FROM agg), 0),
    'items', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'podcast_slug', a.podcast_slug,
            'year', a.year,
            'episode_count', a.episode_count,
            'total_pages', a.total_pages,
            'lastmod', a.lastmod
          )
          ORDER BY a.podcast_slug ASC, a.year DESC
        )
        FROM agg a
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.list_sitemap_podcast_annual_archives_json_v1(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_sitemap_podcast_annual_archives_json_v1(integer, integer) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    REVOKE ALL ON FUNCTION public.list_sitemap_podcast_annual_archives_json_v1(integer, integer) FROM readonly_codex;
  END IF;
END $$;