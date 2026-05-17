
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS ai_bio_sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_bio_confidence numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overview_text text,
  ADD COLUMN IF NOT EXISTS overview_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS overview_sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS wikipedia_extract text,
  ADD COLUMN IF NOT EXISTS wikipedia_description text,
  ADD COLUMN IF NOT EXISTS wikipedia_match_status text NOT NULL DEFAULT 'unchecked',
  ADD COLUMN IF NOT EXISTS wikipedia_match_confidence numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wikipedia_match_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS image_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS strong_mention_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.person_enrichment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS person_enrichment_jobs_person_id_idx ON public.person_enrichment_jobs(person_id);
CREATE INDEX IF NOT EXISTS person_enrichment_jobs_status_idx ON public.person_enrichment_jobs(status);
CREATE INDEX IF NOT EXISTS person_enrichment_jobs_type_idx ON public.person_enrichment_jobs(job_type);

ALTER TABLE public.person_enrichment_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pej public read" ON public.person_enrichment_jobs;
CREATE POLICY "pej public read" ON public.person_enrichment_jobs FOR SELECT USING (true);

DROP POLICY IF EXISTS "pej admin write" ON public.person_enrichment_jobs;
CREATE POLICY "pej admin write" ON public.person_enrichment_jobs FOR ALL USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS people_eligible_idx ON public.people(is_public, episode_count DESC, podcast_count DESC) WHERE is_public = true;
