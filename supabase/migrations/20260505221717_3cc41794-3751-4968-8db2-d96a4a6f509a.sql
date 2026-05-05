
ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS podiverzum_rank integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rank_label text,
  ADD COLUMN IF NOT EXISTS rank_reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rank_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_rank_boost integer NOT NULL DEFAULT 0;

ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS episode_rank integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS episode_rank_label text,
  ADD COLUMN IF NOT EXISTS episode_rank_reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS episode_rank_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_podcasts_rank ON public.podcasts (podiverzum_rank DESC);
CREATE INDEX IF NOT EXISTS idx_podcasts_featured_rank ON public.podcasts (featured, podiverzum_rank DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_rank ON public.episodes (episode_rank DESC);
