
-- 1. ai_call_audit
CREATE TABLE IF NOT EXISTS public.ai_call_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  job_type text NOT NULL,
  provider text NOT NULL DEFAULT 'lovable_ai',
  model_used text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric,
  prompt_version text,
  source_hash text,
  confidence numeric,
  status text NOT NULL DEFAULT 'ok',
  error_message text,
  target_type text,
  target_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ai_call_audit_job_type_created ON public.ai_call_audit(job_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_audit_model ON public.ai_call_audit(model_used);
CREATE INDEX IF NOT EXISTS idx_ai_call_audit_status ON public.ai_call_audit(status) WHERE status <> 'ok';
CREATE INDEX IF NOT EXISTS idx_ai_call_audit_target ON public.ai_call_audit(target_type, target_id);

ALTER TABLE public.ai_call_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_call_audit public read" ON public.ai_call_audit;
CREATE POLICY "ai_call_audit public read" ON public.ai_call_audit FOR SELECT USING (true);

DROP POLICY IF EXISTS "ai_call_audit admin write" ON public.ai_call_audit;
CREATE POLICY "ai_call_audit admin write" ON public.ai_call_audit FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 2. episodes.clean_text_status
ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS clean_text_status text NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_episodes_clean_text_status
  ON public.episodes(clean_text_status)
  WHERE clean_text_status <> 'done';

-- 3. app_settings seed (model policy + clean text controls)
INSERT INTO public.app_settings(key, value) VALUES
  ('lovable_ai_model_policy', jsonb_build_object(
    'version', 'v1-2026-05-20',
    'updated_at', now(),
    'blocklist_substrings', jsonb_build_array('-pro', '/gpt-5-pro', 'gemini-3'),
    'allow_pro_for_manual_flagship', true,
    'jobs', jsonb_build_object(
      'categorize_podcast', jsonb_build_object('primary','google/gemini-2.5-flash-lite','retry','google/gemini-2.5-flash','max_output_tokens',512),
      'seo_enrich',         jsonb_build_object('primary','google/gemini-2.5-flash',     'retry', null,                       'max_output_tokens',1200),
      'entity_backfill',    jsonb_build_object('primary','google/gemini-2.5-flash-lite','retry','google/gemini-2.5-flash','max_output_tokens',768),
      'search_answer',      jsonb_build_object('primary','google/gemini-2.5-flash',     'retry', null,                       'max_output_tokens',900),
      'search_suggest',     jsonb_build_object('primary','google/gemini-2.5-flash-lite','retry', null,                       'max_output_tokens',256),
      'daily_social_post',  jsonb_build_object('primary','google/gemini-2.5-flash',     'retry', null,                       'max_output_tokens',600)
    )
  ))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO public.app_settings(key, value) VALUES
  ('episode_clean_text_controls', jsonb_build_object(
    'enabled', true,
    'batch_limit', 200,
    'time_budget_seconds', 40,
    'method_version', 'deterministic_v1',
    'min_description_chars', 40,
    'note', '2026-05-20: deterministic-only, no AI; gates chunk embed.'
  ))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
