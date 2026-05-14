ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS pi_backfill_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS pi_backfill_episode_count integer,
  ADD COLUMN IF NOT EXISTS pi_backfill_error text;

CREATE INDEX IF NOT EXISTS idx_podcasts_pi_backfill_pending
  ON public.podcasts (podiverzum_rank DESC NULLS LAST)
  WHERE pi_backfill_completed_at IS NULL
    AND rss_status = 'active'
    AND language ILIKE 'hu%';