
-- Episode-level topic/category relevance system

-- 1. Add hint columns to topics
ALTER TABLE public.topics
  ADD COLUMN IF NOT EXISTS positive_hints text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS negative_hints text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS min_evidence_score numeric NOT NULL DEFAULT 0.3;

-- 2. Add hint columns to categories
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS positive_hints text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS negative_hints text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS min_evidence_score numeric NOT NULL DEFAULT 0.3;

-- 3. episode_topic_relevance_reviews — cached judge decisions
CREATE TABLE IF NOT EXISTS public.episode_topic_relevance_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL,
  topic_id uuid NOT NULL,
  candidate_source text NOT NULL,
  status text NOT NULL DEFAULT 'needs_review',
  confidence numeric NOT NULL DEFAULT 0,
  reason_hu text,
  suggested_topic_ids uuid[] NOT NULL DEFAULT '{}',
  reviewed_by text NOT NULL DEFAULT 'rule',
  source_hash text NOT NULL,
  model_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (episode_id, topic_id)
);
CREATE INDEX IF NOT EXISTS etrr_topic_status_idx ON public.episode_topic_relevance_reviews (topic_id, status);
CREATE INDEX IF NOT EXISTS etrr_status_idx ON public.episode_topic_relevance_reviews (status) WHERE status = 'needs_review';
CREATE INDEX IF NOT EXISTS etrr_accepted_idx ON public.episode_topic_relevance_reviews (topic_id, episode_id) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS etrr_episode_idx ON public.episode_topic_relevance_reviews (episode_id);

ALTER TABLE public.episode_topic_relevance_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "etrr public read" ON public.episode_topic_relevance_reviews FOR SELECT USING (true);
CREATE POLICY "etrr admin write" ON public.episode_topic_relevance_reviews FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 4. episode_category_overrides
CREATE TABLE IF NOT EXISTS public.episode_category_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL,
  category_slug text NOT NULL,
  status text NOT NULL DEFAULT 'needs_review',
  confidence numeric NOT NULL DEFAULT 0,
  reason_hu text,
  reviewed_by text NOT NULL DEFAULT 'rule',
  source_hash text NOT NULL,
  model_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (episode_id, category_slug)
);
CREATE INDEX IF NOT EXISTS eco_slug_status_idx ON public.episode_category_overrides (category_slug, status);
CREATE INDEX IF NOT EXISTS eco_episode_idx ON public.episode_category_overrides (episode_id);

ALTER TABLE public.episode_category_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eco public read" ON public.episode_category_overrides FOR SELECT USING (true);
CREATE POLICY "eco admin write" ON public.episode_category_overrides FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 5. trgm indexes (best-effort, only if extension present)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS topics_name_trgm ON public.topics USING gin (name gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS categories_name_trgm ON public.categories USING gin (name gin_trgm_ops)';
  END IF;
END $$;
