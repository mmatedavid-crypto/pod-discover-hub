CREATE TABLE IF NOT EXISTS public.episode_clean_text_candidates (
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  cleaner_method text NOT NULL,
  source_hash text NOT NULL,
  cleaned_text text NOT NULL,
  removed_categories text[] NOT NULL DEFAULT '{}',
  quality_status text NOT NULL DEFAULT 'candidate',
  quality_reasons text[] NOT NULL DEFAULT '{}',
  quality_score numeric,
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (episode_id, cleaner_method, source_hash)
);

CREATE INDEX IF NOT EXISTS episode_clean_text_candidates_status_idx
  ON public.episode_clean_text_candidates (quality_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS episode_clean_text_candidates_episode_idx
  ON public.episode_clean_text_candidates (episode_id, updated_at DESC);

ALTER TABLE public.episode_clean_text_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "episode clean text candidates admin read" ON public.episode_clean_text_candidates;
CREATE POLICY "episode clean text candidates admin read"
  ON public.episode_clean_text_candidates
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "episode clean text candidates service write" ON public.episode_clean_text_candidates;
CREATE POLICY "episode clean text candidates service write"
  ON public.episode_clean_text_candidates
  FOR ALL
  USING (auth.role() = 'service_role' OR has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.role() = 'service_role' OR has_role(auth.uid(), 'admin'));
