-- 1. Add Spotify metadata columns to podcasts
ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS spotify_id TEXT,
  ADD COLUMN IF NOT EXISTS spotify_followers INTEGER,
  ADD COLUMN IF NOT EXISTS spotify_popularity SMALLINT,
  ADD COLUMN IF NOT EXISTS spotify_image_url TEXT,
  ADD COLUMN IF NOT EXISTS spotify_publisher TEXT,
  ADD COLUMN IF NOT EXISTS spotify_languages TEXT[],
  ADD COLUMN IF NOT EXISTS spotify_total_episodes INTEGER,
  ADD COLUMN IF NOT EXISTS spotify_last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS spotify_match_status TEXT,         -- 'unchecked' | 'matched' | 'no_match' | 'manual' | 'error'
  ADD COLUMN IF NOT EXISTS spotify_match_confidence NUMERIC,  -- 0..1 trigram similarity at match time
  ADD COLUMN IF NOT EXISTS spotify_match_method TEXT;         -- 'rss_url' | 'spotify_url' | 'name_publisher' | 'name_only' | 'manual'

CREATE UNIQUE INDEX IF NOT EXISTS podcasts_spotify_id_uniq
  ON public.podcasts (spotify_id) WHERE spotify_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS podcasts_spotify_match_status_idx
  ON public.podcasts (spotify_match_status) WHERE spotify_match_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS podcasts_spotify_last_synced_idx
  ON public.podcasts (spotify_last_synced_at NULLS FIRST);

-- 2. Daily snapshots table for follower / popularity history (trending source)
CREATE TABLE IF NOT EXISTS public.podcast_spotify_snapshots (
  id BIGSERIAL PRIMARY KEY,
  podcast_id UUID NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  spotify_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  followers INTEGER,
  popularity SMALLINT,
  total_episodes INTEGER,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT podcast_spotify_snapshots_uniq UNIQUE (podcast_id, snapshot_date)
);

GRANT SELECT ON public.podcast_spotify_snapshots TO anon, authenticated;
GRANT ALL ON public.podcast_spotify_snapshots TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.podcast_spotify_snapshots_id_seq TO service_role;

ALTER TABLE public.podcast_spotify_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read snapshots"
  ON public.podcast_spotify_snapshots FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS spotify_snapshots_podcast_date_idx
  ON public.podcast_spotify_snapshots (podcast_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS spotify_snapshots_date_idx
  ON public.podcast_spotify_snapshots (snapshot_date DESC);
