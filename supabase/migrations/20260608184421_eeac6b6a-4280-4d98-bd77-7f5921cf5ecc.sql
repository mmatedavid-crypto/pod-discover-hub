
ALTER TABLE public.search_events
  ADD COLUMN IF NOT EXISTS semantic_used boolean,
  ADD COLUMN IF NOT EXISTS reranked boolean,
  ADD COLUMN IF NOT EXISTS podcast_pin_slug text,
  ADD COLUMN IF NOT EXISTS person_pin_slug text,
  ADD COLUMN IF NOT EXISTS organization_pin_slug text,
  ADD COLUMN IF NOT EXISTS topic_pin_slug text,
  ADD COLUMN IF NOT EXISTS catalog_anchors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS anchor_episode_candidates integer,
  ADD COLUMN IF NOT EXISTS natural_question jsonb,
  ADD COLUMN IF NOT EXISTS natural_question_fallback boolean,
  ADD COLUMN IF NOT EXISTS degraded_for_latency boolean,
  ADD COLUMN IF NOT EXISTS timing jsonb,
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
