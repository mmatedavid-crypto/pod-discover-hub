-- Capture timestamp-aware retrieval telemetry in search_events.
-- This lets search audits measure whether transcript chunk search is producing
-- jump-to-time results, not just generic episode matches.

ALTER TABLE public.search_events
  ADD COLUMN IF NOT EXISTS timestamp_match_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chunk_augmented_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS search_events_timestamp_matches_idx
  ON public.search_events (created_at DESC, timestamp_match_count, chunk_augmented_count);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'search_events'
      AND column_name = 'timestamp_match_count'
  ) THEN
    RAISE EXCEPTION 'search_events.timestamp_match_count telemetry column missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'search_events'
      AND column_name = 'chunk_augmented_count'
  ) THEN
    RAISE EXCEPTION 'search_events.chunk_augmented_count telemetry column missing';
  END IF;
END $$;
