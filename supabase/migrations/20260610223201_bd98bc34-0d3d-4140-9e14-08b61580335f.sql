
-- daily_trends: snapshot of Google Trends keywords for HU
CREATE TABLE IF NOT EXISTS public.daily_trends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword text NOT NULL,
  normalized_keyword text GENERATED ALWAYS AS (lower(keyword)) STORED,
  rank int,
  traffic text,
  related_queries jsonb DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'apify_google_trends',
  region text NOT NULL DEFAULT 'HU',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  batch_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_trends_active_rank_idx ON public.daily_trends (is_active, rank) WHERE is_active;
CREATE INDEX IF NOT EXISTS daily_trends_fetched_at_idx ON public.daily_trends (fetched_at DESC);
CREATE INDEX IF NOT EXISTS daily_trends_batch_idx ON public.daily_trends (batch_id);

GRANT SELECT ON public.daily_trends TO anon, authenticated;
GRANT ALL ON public.daily_trends TO service_role;

ALTER TABLE public.daily_trends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_trends public read"
  ON public.daily_trends FOR SELECT
  USING (true);

CREATE POLICY "daily_trends admin write"
  ON public.daily_trends FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- daily_trend_episodes: matched episodes for each trend
CREATE TABLE IF NOT EXISTS public.daily_trend_episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trend_id uuid NOT NULL REFERENCES public.daily_trends(id) ON DELETE CASCADE,
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  rank int NOT NULL,
  score double precision,
  match_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trend_id, episode_id)
);

CREATE INDEX IF NOT EXISTS daily_trend_episodes_trend_rank_idx ON public.daily_trend_episodes (trend_id, rank);
CREATE INDEX IF NOT EXISTS daily_trend_episodes_episode_idx ON public.daily_trend_episodes (episode_id);

GRANT SELECT ON public.daily_trend_episodes TO anon, authenticated;
GRANT ALL ON public.daily_trend_episodes TO service_role;

ALTER TABLE public.daily_trend_episodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_trend_episodes public read"
  ON public.daily_trend_episodes FOR SELECT
  USING (true);

CREATE POLICY "daily_trend_episodes admin write"
  ON public.daily_trend_episodes FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
