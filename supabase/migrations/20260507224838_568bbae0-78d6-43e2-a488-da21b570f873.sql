
-- F1: incremental refresh failure backoff
ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS next_fetch_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_podcasts_next_fetch_at
  ON public.podcasts (next_fetch_at)
  WHERE crawl_state IN ('full_backfilled','incremental_refresh');

-- Backfill: existing failed feeds get a backoff stamp; healthy feeds remain NULL (treated as due-by-tier)
UPDATE public.podcasts
   SET next_fetch_at = COALESCE(last_fetched_at, now())
        + make_interval(mins => LEAST(10080, 30 * (2 ^ LEAST(consecutive_failure_count, 8)))::int)
 WHERE consecutive_failure_count > 0
   AND crawl_state IN ('full_backfilled','incremental_refresh');

-- F4: discovery_queue import backoff
ALTER TABLE public.discovery_queue
  ADD COLUMN IF NOT EXISTS import_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_import_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_discovery_queue_next_attempt
  ON public.discovery_queue (next_import_attempt_at)
  WHERE status = 'pending';

-- F5: pi_feed_staging processing backoff
ALTER TABLE public.pi_feed_staging
  ADD COLUMN IF NOT EXISTS process_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_process_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pi_feed_staging_next_attempt
  ON public.pi_feed_staging (next_process_attempt_at)
  WHERE processed = false;

-- F3: deep-hydration target-bump reopen trigger
CREATE OR REPLACE FUNCTION public.reopen_deep_hydration_on_target_bump()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.deep_hydration_target IS NOT NULL
     AND NEW.deep_hydration_target > COALESCE(OLD.deep_hydration_target, 0)
     AND NEW.deep_hydration_target > COALESCE(NEW.hydrated_episode_count, 0)
     AND OLD.full_backfill_completed_at IS NOT NULL
  THEN
    NEW.full_backfill_completed_at := NULL;
    NEW.deep_hydration_status := 'not_started';
    -- Preserve advanced crawl states; otherwise mark pending
    IF NEW.crawl_state NOT IN ('incremental_refresh','full_backfilled') THEN
      NEW.crawl_state := 'full_backfill_pending';
    ELSE
      NEW.crawl_state := 'full_backfill_pending';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_reopen_deep_hydration_on_target_bump ON public.podcasts;
CREATE TRIGGER trg_reopen_deep_hydration_on_target_bump
BEFORE UPDATE OF deep_hydration_target ON public.podcasts
FOR EACH ROW
EXECUTE FUNCTION public.reopen_deep_hydration_on_target_bump();
