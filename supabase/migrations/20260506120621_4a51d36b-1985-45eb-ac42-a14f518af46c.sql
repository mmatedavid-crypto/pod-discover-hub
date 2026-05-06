ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS deep_hydration_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS hydrated_episode_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_deep_hydrated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deep_hydration_target integer,
  ADD COLUMN IF NOT EXISTS deep_hydration_error text;

CREATE INDEX IF NOT EXISTS idx_podcasts_deep_hydration_priority
  ON public.podcasts (podiverzum_rank DESC, last_deep_hydrated_at NULLS FIRST)
  WHERE deep_hydration_status IN ('not_started', 'failed');