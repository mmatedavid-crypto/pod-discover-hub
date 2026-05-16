ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS youtube_last_episode_pair_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_podcasts_yt_last_ep_pair
  ON public.podcasts (youtube_last_episode_pair_at NULLS FIRST)
  WHERE youtube_pairing_status = 'paired';