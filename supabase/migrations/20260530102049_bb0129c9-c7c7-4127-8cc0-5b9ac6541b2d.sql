ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS ai_enrich_input_hash text,
  ADD COLUMN IF NOT EXISTS ai_enrich_prompt_version text;

ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS ai_enrich_input_hash text,
  ADD COLUMN IF NOT EXISTS ai_enrich_prompt_version text;

CREATE INDEX IF NOT EXISTS idx_episodes_ai_enrich_input_hash
  ON public.episodes (ai_enrich_input_hash)
  WHERE ai_enrich_input_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_podcasts_ai_enrich_input_hash
  ON public.podcasts (ai_enrich_input_hash)
  WHERE ai_enrich_input_hash IS NOT NULL;