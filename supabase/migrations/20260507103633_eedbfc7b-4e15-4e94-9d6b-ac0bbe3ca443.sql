ALTER TABLE public.podcasts ADD COLUMN IF NOT EXISTS full_backfill_completed_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS podcasts_full_backfill_idx ON public.podcasts(full_backfill_completed_at);