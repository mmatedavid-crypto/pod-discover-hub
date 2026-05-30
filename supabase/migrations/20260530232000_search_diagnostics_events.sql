-- Search diagnostics captured from search-hybrid responses.
-- This makes weekly search audits actionable: we can see which retrieval path
-- answered each query, not just whether it returned results.

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
  ADD COLUMN IF NOT EXISTS timing jsonb;

CREATE INDEX IF NOT EXISTS search_events_pins_idx
  ON public.search_events (created_at DESC, podcast_pin_slug, person_pin_slug, organization_pin_slug, topic_pin_slug);

CREATE INDEX IF NOT EXISTS search_events_diag_gin_idx
  ON public.search_events USING gin (catalog_anchors);
