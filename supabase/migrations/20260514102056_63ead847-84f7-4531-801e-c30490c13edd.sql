ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS pi_backfill_approved boolean,
  ADD COLUMN IF NOT EXISTS pi_backfill_dry_run jsonb,
  ADD COLUMN IF NOT EXISTS pi_backfill_peeked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_podcasts_pi_backfill_peek_pending
  ON public.podcasts (podiverzum_rank DESC NULLS LAST)
  WHERE language ILIKE 'hu%'
    AND rss_status = 'active'
    AND pi_backfill_completed_at IS NULL
    AND rank_label IN ('B','C')
    AND pi_backfill_peeked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_podcasts_pi_backfill_approval_queue
  ON public.podcasts (podiverzum_rank DESC NULLS LAST)
  WHERE language ILIKE 'hu%'
    AND rss_status = 'active'
    AND pi_backfill_completed_at IS NULL
    AND rank_label IN ('B','C');