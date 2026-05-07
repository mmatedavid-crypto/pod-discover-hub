
-- Stage 2: additive schema for hybrid AI-assisted rank. No behavioral changes.

-- A. AI quality fields on podcasts
ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS ai_quality_score numeric(3,1),
  ADD COLUMN IF NOT EXISTS ai_spam_score numeric(3,1),
  ADD COLUMN IF NOT EXISTS ai_quality_reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_quality_model text,
  ADD COLUMN IF NOT EXISTS ai_quality_input_hash text,
  ADD COLUMN IF NOT EXISTS ai_quality_updated_at timestamptz;

-- B. Shadow rank fields on podcasts
ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS shadow_rank numeric(3,1),
  ADD COLUMN IF NOT EXISTS shadow_rank_tier text,
  ADD COLUMN IF NOT EXISTS shadow_rank_components jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS shadow_computed_at timestamptz;

-- C. Crawl priority (nullable until Stage 6)
ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS crawl_priority text;

-- D. Pre-crawl AI gate fields on pi_feed_staging
ALTER TABLE public.pi_feed_staging
  ADD COLUMN IF NOT EXISTS ai_decision text,
  ADD COLUMN IF NOT EXISTS ai_quality_score numeric(3,1),
  ADD COLUMN IF NOT EXISTS ai_spam_score numeric(3,1),
  ADD COLUMN IF NOT EXISTS ai_active_signal text,
  ADD COLUMN IF NOT EXISTS ai_likely_category text,
  ADD COLUMN IF NOT EXISTS ai_detected_language text,
  ADD COLUMN IF NOT EXISTS ai_confidence numeric(3,2),
  ADD COLUMN IF NOT EXISTS ai_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_gated_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_input_hash text,
  ADD COLUMN IF NOT EXISTS ai_model text;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_podcasts_shadow_rank ON public.podcasts (shadow_rank DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_podcasts_crawl_priority ON public.podcasts (crawl_priority);
CREATE INDEX IF NOT EXISTS idx_podcasts_ai_quality_score ON public.podcasts (ai_quality_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_pi_feed_staging_ai_decision ON public.pi_feed_staging (ai_decision, processed);
CREATE INDEX IF NOT EXISTS idx_pi_feed_staging_ai_input_hash ON public.pi_feed_staging (ai_input_hash);
