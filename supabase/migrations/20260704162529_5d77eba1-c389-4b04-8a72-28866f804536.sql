
CREATE TABLE IF NOT EXISTS public.person_external_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_url text NOT NULL,
  source_domain text,
  podcast_id uuid REFERENCES public.podcasts(id) ON DELETE SET NULL,
  episode_id uuid REFERENCES public.episodes(id) ON DELETE SET NULL,
  scraped_at timestamptz,
  scraped_text text,
  scraped_title text,
  content_length int,
  name_match_score numeric,
  name_match_reason text,
  name_match_model text,
  trust_score numeric NOT NULL DEFAULT 0.5,
  status text NOT NULL DEFAULT 'pending',
  firecrawl_cost numeric NOT NULL DEFAULT 0,
  ai_cost numeric NOT NULL DEFAULT 0,
  http_status int,
  error text,
  last_attempt_at timestamptz,
  attempt_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_external_sources_url_uniq UNIQUE (person_id, source_url)
);

CREATE INDEX IF NOT EXISTS idx_pes_person ON public.person_external_sources(person_id);
CREATE INDEX IF NOT EXISTS idx_pes_status ON public.person_external_sources(status) WHERE status IN ('pending','draft');
CREATE INDEX IF NOT EXISTS idx_pes_domain ON public.person_external_sources(source_domain);
CREATE INDEX IF NOT EXISTS idx_pes_updated ON public.person_external_sources(updated_at DESC);

GRANT SELECT ON public.person_external_sources TO authenticated;
GRANT ALL ON public.person_external_sources TO service_role;

ALTER TABLE public.person_external_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read person external sources"
  ON public.person_external_sources FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update person external sources"
  ON public.person_external_sources FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.pes_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_pes_touch ON public.person_external_sources;
CREATE TRIGGER trg_pes_touch BEFORE UPDATE ON public.person_external_sources
  FOR EACH ROW EXECUTE FUNCTION public.pes_touch_updated_at();
