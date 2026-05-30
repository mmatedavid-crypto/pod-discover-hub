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

GRANT SELECT ON public.episode_clean_text_candidates TO authenticated;
GRANT ALL ON public.episode_clean_text_candidates TO service_role;

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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    GRANT SELECT ON public.episode_clean_text_candidates TO readonly_codex;
  END IF;
END $$;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_clean_text_controls',
  jsonb_build_object(
    'enabled', true,
    'batch_limit', 500,
    'method_version', 'deterministic_v4',
    'time_budget_seconds', 60,
    'min_description_chars', 40,
    'note', '2026-05-30: deterministic_v4 strips bare platform URLs, emails, handles and orphan link labels; no AI.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'enabled', true,
    'method_version', 'deterministic_v4',
    'batch_limit', 500,
    'time_budget_seconds', 60,
    'min_description_chars', 40,
    'note', '2026-05-30: deterministic_v4 strips bare platform URLs, emails, handles and orphan link labels; no AI.'
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'clean_text_autopilot',
  jsonb_build_object(
    'enabled', true,
    'dry_run', false,
    'mode', 'bad_or_old',
    'tiers', jsonb_build_array('S','A','B','C','D','E'),
    'stage_limit', 1000,
    'candidate_batch', 500,
    'promote_limit', 500,
    'ai_enrich_limit', 0,
    'daily_budget_usd', 0,
    'auto_stop_at_errors', 5,
    'consecutive_errors', 0,
    'note', 'Fast deterministic clean-text v4 sweep. Promotion is quality-gated; AI reprocess is intentionally disabled until v4 coverage is verified.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'enabled', true,
    'dry_run', false,
    'mode', 'bad_or_old',
    'tiers', jsonb_build_array('S','A','B','C','D','E'),
    'stage_limit', 1000,
    'candidate_batch', 500,
    'promote_limit', 500,
    'ai_enrich_limit', 0,
    'daily_budget_usd', 0,
    'auto_stop_at_errors', 5,
    'consecutive_errors', 0,
    'note', 'Fast deterministic clean-text v4 sweep. Promotion is quality-gated; AI reprocess is intentionally disabled until v4 coverage is verified.'
  ),
  updated_at = now();