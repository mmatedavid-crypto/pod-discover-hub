
-- Podcast charts: daily snapshots from Apple/Spotify/YouTube proxy
CREATE TABLE IF NOT EXISTS public.podcast_charts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('apple','spotify','youtube')),
  country text NOT NULL DEFAULT 'hu',
  rank int NOT NULL,
  podcast_id uuid NULL REFERENCES public.podcasts(id) ON DELETE SET NULL,
  raw_name text NOT NULL,
  raw_artist text NULL,
  raw_external_id text NULL,
  raw_url text NULL,
  image_url text NULL,
  matched_via text NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.podcast_charts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.podcast_charts TO authenticated;
GRANT ALL ON public.podcast_charts TO service_role;

ALTER TABLE public.podcast_charts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "charts public read" ON public.podcast_charts FOR SELECT USING (true);
CREATE POLICY "charts admin write" ON public.podcast_charts FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE INDEX idx_podcast_charts_snapshot ON public.podcast_charts (source, country, snapshot_at DESC);
CREATE INDEX idx_podcast_charts_podcast ON public.podcast_charts (podcast_id) WHERE podcast_id IS NOT NULL;

-- YouTube channel stats snapshots (for view-delta proxy)
CREATE TABLE IF NOT EXISTS public.youtube_channel_stats (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id text NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  subscriber_count bigint NULL,
  view_count bigint NULL,
  video_count int NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.youtube_channel_stats TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.youtube_channel_stats TO authenticated;
GRANT ALL ON public.youtube_channel_stats TO service_role;

ALTER TABLE public.youtube_channel_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "yt_stats public read" ON public.youtube_channel_stats FOR SELECT USING (true);
CREATE POLICY "yt_stats admin write" ON public.youtube_channel_stats FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE INDEX idx_yt_stats_channel_time ON public.youtube_channel_stats (channel_id, snapshot_at DESC);

-- Trending podcasts: reciprocal-rank fusion across latest snapshot per source
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
    SELECT c.*
    FROM public.podcast_charts c
    JOIN latest_snap ls ON ls.source = c.source AND ls.snap = c.snapshot_at
    WHERE c.podcast_id IS NOT NULL
  ),
  scored AS (
    SELECT
      podcast_id,
      sum(1.0 / rank)::numeric AS trending_score,
      jsonb_agg(jsonb_build_object('source', source, 'rank', rank) ORDER BY rank) AS sources,
      max(snapshot_at) AS snapshot_at
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
  WHERE p.language ILIKE 'hu%'
    AND p.rss_status NOT IN ('failed','inactive')
  ORDER BY s.trending_score DESC, p.podiverzum_rank DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_trending_podcasts(int) TO anon, authenticated, service_role;
