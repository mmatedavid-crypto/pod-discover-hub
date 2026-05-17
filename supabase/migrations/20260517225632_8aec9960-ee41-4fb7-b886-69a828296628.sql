CREATE TABLE IF NOT EXISTS public.hu_archive_backfill_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  trigger_source text NOT NULL DEFAULT 'cron',
  tier_filter text[] NOT NULL DEFAULT '{}',
  podcasts_processed integer NOT NULL DEFAULT 0,
  new_episodes_inserted integer NOT NULL DEFAULT 0,
  duplicates_skipped integer NOT NULL DEFAULT 0,
  failed_feeds integer NOT NULL DEFAULT 0,
  throttled boolean NOT NULL DEFAULT false,
  skipped_reason text,
  runtime_ms integer,
  ai_backlog_before integer,
  ai_backlog_after integer,
  embedding_backlog_before integer,
  embedding_backlog_after integer,
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hu_archive_runs_started ON public.hu_archive_backfill_runs (started_at DESC);

ALTER TABLE public.hu_archive_backfill_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "habr public read" ON public.hu_archive_backfill_runs;
CREATE POLICY "habr public read" ON public.hu_archive_backfill_runs FOR SELECT USING (true);

DROP POLICY IF EXISTS "habr admin write" ON public.hu_archive_backfill_runs;
CREATE POLICY "habr admin write" ON public.hu_archive_backfill_runs FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));