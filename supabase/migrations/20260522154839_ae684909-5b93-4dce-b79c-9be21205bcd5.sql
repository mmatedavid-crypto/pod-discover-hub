
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ai_review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ai_review_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_review_confidence numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_review_flags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_review_summary text,
  ADD COLUMN IF NOT EXISTS ai_recommended_action text,
  ADD COLUMN IF NOT EXISTS ai_recommended_canonical_name text,
  ADD COLUMN IF NOT EXISTS ai_recommended_org_type text,
  ADD COLUMN IF NOT EXISTS ai_duplicate_of_organization_id uuid,
  ADD COLUMN IF NOT EXISTS ai_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_review_model text,
  ADD COLUMN IF NOT EXISTS ai_review_sources jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_orgs_ai_review_pending
  ON public.organizations (ai_review_status, episode_count DESC)
  WHERE ai_review_status = 'pending' AND is_public = true;

CREATE TABLE IF NOT EXISTS public.org_ai_review_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  started_at timestamptz,
  finished_at timestamptz,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oarj_org ON public.org_ai_review_jobs (organization_id, created_at DESC);

ALTER TABLE public.org_ai_review_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oarj admin write" ON public.org_ai_review_jobs;
CREATE POLICY "oarj admin write" ON public.org_ai_review_jobs
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "oarj public read" ON public.org_ai_review_jobs;
CREATE POLICY "oarj public read" ON public.org_ai_review_jobs
  FOR SELECT USING (true);
