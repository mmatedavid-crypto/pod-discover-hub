-- Extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ============ Columns ============
ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS display_title text,
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS ai_enriched_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_entities_version int NOT NULL DEFAULT 0;

ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS display_title text,
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_enriched_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_entities_version int NOT NULL DEFAULT 0;

-- ============ ai_enrichment_jobs ============
CREATE TABLE IF NOT EXISTS public.ai_enrichment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,                    -- 'title_cleanup' | 'seo_meta' | 'entities' | 'embedding'
  target_type text NOT NULL,             -- 'podcast' | 'episode'
  target_id uuid NOT NULL,
  priority int NOT NULL DEFAULT 0,
  input_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',-- pending|in_progress|completed|failed|skipped
  attempts int NOT NULL DEFAULT 0,
  model text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10,6),
  last_error text,
  locked_until timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT ai_jobs_unique_cache UNIQUE (kind, target_type, target_id, input_hash)
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_queue
  ON public.ai_enrichment_jobs (status, priority DESC, created_at)
  WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS idx_ai_jobs_target
  ON public.ai_enrichment_jobs (target_type, target_id);

ALTER TABLE public.ai_enrichment_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_jobs admin write" ON public.ai_enrichment_jobs
  FOR ALL USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "ai_jobs public read" ON public.ai_enrichment_jobs
  FOR SELECT USING (true);

-- ============ Embedding tables ============
CREATE TABLE IF NOT EXISTS public.episode_embeddings (
  episode_id uuid PRIMARY KEY,
  podcast_id uuid NOT NULL,
  model text NOT NULL,
  embedding vector(768) NOT NULL,
  content_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_episode_embeddings_podcast
  ON public.episode_embeddings (podcast_id);
-- ivfflat index added later once we have ≥10k rows; HNSW would be better but ivfflat is fine for now.

ALTER TABLE public.episode_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_emb admin write" ON public.episode_embeddings
  FOR ALL USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "ep_emb public read" ON public.episode_embeddings
  FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.podcast_embeddings (
  podcast_id uuid PRIMARY KEY,
  model text NOT NULL,
  embedding vector(768) NOT NULL,
  content_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.podcast_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pod_emb admin write" ON public.podcast_embeddings
  FOR ALL USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "pod_emb public read" ON public.podcast_embeddings
  FOR SELECT USING (true);

-- ============ Daily AI spend tracker ============
CREATE TABLE IF NOT EXISTS public.ai_spend_daily (
  day date PRIMARY KEY,
  spend_usd numeric(10,4) NOT NULL DEFAULT 0,
  calls int NOT NULL DEFAULT 0,
  by_kind jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_spend_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_spend admin write" ON public.ai_spend_daily
  FOR ALL USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "ai_spend public read" ON public.ai_spend_daily
  FOR SELECT USING (true);
