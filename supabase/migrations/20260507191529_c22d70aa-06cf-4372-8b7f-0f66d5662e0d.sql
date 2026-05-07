ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS next_rss_hunt_at timestamptz,
  ADD COLUMN IF NOT EXISTS rss_hunt_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_rss_hunt_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_podcasts_next_rss_hunt_at
  ON public.podcasts (next_rss_hunt_at)
  WHERE next_rss_hunt_at IS NOT NULL;