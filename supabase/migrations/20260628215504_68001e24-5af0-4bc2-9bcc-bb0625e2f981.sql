CREATE OR REPLACE FUNCTION public.get_trending_podcasts(p_limit int DEFAULT 12)
RETURNS TABLE (
  id uuid,
  title text,
  display_title text,
  slug text,
  summary text,
  description text,
  image_url text,
  category text,
  apple_url text,
  spotify_url text,
  youtube_url text,
  website_url text,
  podiverzum_rank numeric,
  rank_label text,
  trending_score numeric,
  sources jsonb,
  snapshot_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_snap AS (
    SELECT source, max(snapshot_at) AS snap
    FROM public.podcast_charts
    WHERE country = 'hu'
      AND snapshot_at > now() - interval '7 days'
    GROUP BY source
  ),
  current_charts AS (
    SELECT DISTINCT ON (c.podcast_id, c.source)
      c.podcast_id, c.source, c.rank, c.snapshot_at
    FROM public.podcast_charts c
    JOIN latest_snap ls ON ls.source = c.source AND ls.snap = c.snapshot_at
    WHERE c.podcast_id IS NOT NULL
    ORDER BY c.podcast_id, c.source, c.rank ASC
  ),
  scored AS (
    SELECT
      podcast_id,
      sum(1.0 / (60.0 + rank))::numeric AS trending_score,
      jsonb_agg(jsonb_build_object('source', source, 'rank', rank) ORDER BY rank) AS sources,
      max(snapshot_at) AS snapshot_at,
      min(rank) AS best_rank,
      count(DISTINCT source) AS source_count
    FROM current_charts
    GROUP BY podcast_id
  )
  SELECT
    p.id, p.title, p.display_title, p.slug, p.summary, p.description,
    p.image_url, p.category, p.apple_url, p.spotify_url, p.youtube_url, p.website_url,
    p.podiverzum_rank, p.rank_label,
    s.trending_score, s.sources, s.snapshot_at
  FROM scored s
  JOIN public.podcasts p ON p.id = s.podcast_id
  WHERE COALESCE(p.rss_status, '') NOT IN ('failed','inactive','deleted')
    AND COALESCE(p.ai_spam_score, 0) < 0.80
    AND (
      COALESCE(p.is_hungarian, false) = true
      OR p.language_decision = 'accept_hungarian'
      OR p.language ILIKE 'hu%'
    )
    AND COALESCE(p.shadow_rank_components->>'health_state','healthy')
        IN ('healthy','recovered_rss_url')
  ORDER BY s.source_count DESC, s.trending_score DESC, s.best_rank ASC, COALESCE(p.podiverzum_rank, 0) DESC
  LIMIT greatest(1, least(coalesce(p_limit, 12), 100));
$$;

GRANT EXECUTE ON FUNCTION public.get_trending_podcasts(int) TO anon, authenticated, service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'trending_podcasts_policy',
  jsonb_build_object(
    'version', 'rrf_v3_spotify_search',
    'sources', jsonb_build_array('apple', 'spotify', 'youtube'),
    'spotify_method', 'Spotify Web API search (HU market, multi-keyword RRF)',
    'dedupe', 'best rank per podcast per source',
    'scoring', 'reciprocal rank fusion (k=60) with multi-source priority tie-breaker',
    'eligibility', 'Hungarian non-spam active podcasts'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();