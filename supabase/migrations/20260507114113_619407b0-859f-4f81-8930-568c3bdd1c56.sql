-- 1. Add new columns to podcasts
ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS crawl_state TEXT NOT NULL DEFAULT 'staged',
  ADD COLUMN IF NOT EXISTS refresh_interval_minutes INT NOT NULL DEFAULT 360,
  ADD COLUMN IF NOT EXISTS last_etag TEXT,
  ADD COLUMN IF NOT EXISTS last_modified TEXT,
  ADD COLUMN IF NOT EXISTS consecutive_failure_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quarantined_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_podcasts_crawl_state ON public.podcasts(crawl_state);
CREATE INDEX IF NOT EXISTS idx_podcasts_refresh_due
  ON public.podcasts(last_fetched_at NULLS FIRST)
  WHERE crawl_state IN ('full_backfilled','incremental_refresh');

-- 2. Backfill crawl_state from current implicit fields
UPDATE public.podcasts SET crawl_state = CASE
  WHEN rss_status = 'failed' AND COALESCE(last_fetch_error,'') ILIKE '%410%' THEN 'dead'
  WHEN rss_status = 'failed' THEN 'quarantined'
  WHEN full_backfill_completed_at IS NOT NULL THEN 'incremental_refresh'
  WHEN deep_hydration_status = 'completed' THEN 'full_backfilled'
  WHEN deep_hydration_status = 'in_progress' THEN 'full_backfill_pending'
  WHEN last_fetched_at IS NOT NULL THEN 'light_indexed'
  ELSE 'staged'
END;

-- 3. Backfill refresh_interval_minutes from rank tier
UPDATE public.podcasts SET refresh_interval_minutes = CASE
  WHEN podiverzum_rank >= 8 THEN 60
  WHEN podiverzum_rank >= 5 THEN 360
  WHEN podiverzum_rank >= 2 THEN 1440
  ELSE 10080
END;

-- 4. Trigger: keep refresh_interval_minutes in sync with rank tier
CREATE OR REPLACE FUNCTION public.sync_refresh_interval_from_rank()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.podiverzum_rank IS DISTINCT FROM OLD.podiverzum_rank THEN
    NEW.refresh_interval_minutes := CASE
      WHEN NEW.podiverzum_rank >= 8 THEN 60
      WHEN NEW.podiverzum_rank >= 5 THEN 360
      WHEN NEW.podiverzum_rank >= 2 THEN 1440
      ELSE 10080
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_podcasts_sync_refresh_interval ON public.podcasts;
CREATE TRIGGER trg_podcasts_sync_refresh_interval
  BEFORE UPDATE OF podiverzum_rank ON public.podcasts
  FOR EACH ROW EXECUTE FUNCTION public.sync_refresh_interval_from_rank();

-- 5. rss_url_history table
CREATE TABLE IF NOT EXISTS public.rss_url_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  podcast_id UUID NOT NULL,
  old_url TEXT,
  new_url TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rss_url_history_podcast ON public.rss_url_history(podcast_id, changed_at DESC);

ALTER TABLE public.rss_url_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rss_url_history public read"
  ON public.rss_url_history FOR SELECT USING (true);

CREATE POLICY "rss_url_history admin write"
  ON public.rss_url_history FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));