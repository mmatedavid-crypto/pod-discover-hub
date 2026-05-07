
-- Indexes for queue throughput
CREATE INDEX IF NOT EXISTS idx_ai_jobs_status_priority
  ON public.ai_enrichment_jobs (status, priority DESC, created_at)
  WHERE status IN ('pending','processing');

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_jobs_kind_target_hash
  ON public.ai_enrichment_jobs (kind, target_type, target_id, input_hash);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_target
  ON public.ai_enrichment_jobs (target_type, target_id);

-- Default controls
INSERT INTO public.app_settings (key, value)
VALUES (
  'ai_seo_controls',
  jsonb_build_object(
    'enabled', false,
    'daily_budget_usd', 1.0,
    'min_rank', 8,
    'require_full_backfill', true,
    'max_podcasts_per_run', 50,
    'max_episodes_per_run', 300,
    'model', 'google/gemini-2.5-flash',
    'max_attempts', 3
  )
)
ON CONFLICT (key) DO NOTHING;

-- Atomic batch claimer
CREATE OR REPLACE FUNCTION public.claim_ai_jobs(_limit int, _lock_seconds int DEFAULT 120)
RETURNS SETOF public.ai_enrichment_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.ai_enrichment_jobs j
     SET status = 'processing',
         locked_until = now() + make_interval(secs => _lock_seconds),
         started_at = now(),
         attempts = attempts + 1
   WHERE j.id IN (
     SELECT id FROM public.ai_enrichment_jobs
      WHERE (status = 'pending')
         OR (status = 'processing' AND locked_until < now())
      ORDER BY priority DESC, created_at ASC
      LIMIT _limit
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END $$;

REVOKE ALL ON FUNCTION public.claim_ai_jobs(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ai_jobs(int, int) TO service_role;
