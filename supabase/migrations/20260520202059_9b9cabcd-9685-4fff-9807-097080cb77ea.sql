
-- AI audit completeness + budget guard scaffolding
ALTER TABLE public.ai_call_audit
  ADD COLUMN IF NOT EXISTS latency_ms integer,
  ADD COLUMN IF NOT EXISTS key_source text;

CREATE INDEX IF NOT EXISTS idx_ai_call_audit_created_status
  ON public.ai_call_audit (created_at DESC, status);

CREATE INDEX IF NOT EXISTS idx_ai_call_audit_job_created
  ON public.ai_call_audit (job_type, created_at DESC);
