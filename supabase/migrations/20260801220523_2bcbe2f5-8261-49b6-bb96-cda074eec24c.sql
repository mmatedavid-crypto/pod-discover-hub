DROP FUNCTION IF EXISTS public.claim_ai_jobs(integer, integer);
CREATE OR REPLACE FUNCTION public.claim_ai_jobs(_limit integer DEFAULT 50, _lock_seconds integer DEFAULT 120)
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
      WHERE (status = 'pending' AND (locked_until IS NULL OR locked_until < now()))
         OR (status = 'processing' AND locked_until < now())
      ORDER BY priority DESC, created_at ASC
      LIMIT _limit
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END
$$;
GRANT EXECUTE ON FUNCTION public.claim_ai_jobs(integer, integer) TO service_role;