-- Podcasts: language gate fields
ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS language_decision text,
  ADD COLUMN IF NOT EXISTS hungarian_score integer,
  ADD COLUMN IF NOT EXISTS foreign_score integer,
  ADD COLUMN IF NOT EXISTS detected_language text,
  ADD COLUMN IF NOT EXISTS language_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS language_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS language_rejection_reason text,
  ADD COLUMN IF NOT EXISTS is_hungarian boolean NOT NULL DEFAULT false;

-- Episodes: language gate fields
ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS detected_language text,
  ADD COLUMN IF NOT EXISTS hungarian_score integer,
  ADD COLUMN IF NOT EXISTS foreign_score integer,
  ADD COLUMN IF NOT EXISTS language_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS language_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Bootstrap: trust current hu* podcasts as a starting point; audit will re-verify and demote.
UPDATE public.podcasts
SET is_hungarian = true,
    language_decision = 'accept_hungarian'
WHERE language ILIKE 'hu%'
  AND language_decision IS NULL;

-- Indexes for public filtering
CREATE INDEX IF NOT EXISTS idx_podcasts_is_hungarian_decision ON public.podcasts (is_hungarian, language_decision);
CREATE INDEX IF NOT EXISTS idx_podcasts_language_checked_at ON public.podcasts (language_checked_at);
CREATE INDEX IF NOT EXISTS idx_podcasts_language_decision ON public.podcasts (language_decision) WHERE language_decision IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_episodes_language_checked_at ON public.episodes (language_checked_at);

-- Review queue table
CREATE TABLE IF NOT EXISTS public.podcast_language_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  podcast_id uuid NOT NULL,
  title text,
  rss_url text,
  website_url text,
  detected_language text,
  hungarian_score integer,
  foreign_score integer,
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plrq_podcast_pending ON public.podcast_language_review_queue (podcast_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_plrq_status ON public.podcast_language_review_queue (status, created_at DESC);

ALTER TABLE public.podcast_language_review_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plrq public read" ON public.podcast_language_review_queue;
CREATE POLICY "plrq public read" ON public.podcast_language_review_queue FOR SELECT USING (true);
DROP POLICY IF EXISTS "plrq admin write" ON public.podcast_language_review_queue;
CREATE POLICY "plrq admin write" ON public.podcast_language_review_queue FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Cleanup audit log
CREATE TABLE IF NOT EXISTS public.podcast_language_cleanup_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  podcast_id uuid,
  title text,
  rss_url text,
  detected_language text,
  hungarian_score integer,
  foreign_score integer,
  deletion_reason text NOT NULL,
  deleted_related_episode_count integer NOT NULL DEFAULT 0,
  deleted_embedding_count integer NOT NULL DEFAULT 0,
  deleted_ai_job_count integer NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plcl_deleted_at ON public.podcast_language_cleanup_log (deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_plcl_reason ON public.podcast_language_cleanup_log (deletion_reason, deleted_at DESC);

ALTER TABLE public.podcast_language_cleanup_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plcl public read" ON public.podcast_language_cleanup_log;
CREATE POLICY "plcl public read" ON public.podcast_language_cleanup_log FOR SELECT USING (true);
DROP POLICY IF EXISTS "plcl admin write" ON public.podcast_language_cleanup_log;
CREATE POLICY "plcl admin write" ON public.podcast_language_cleanup_log FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));