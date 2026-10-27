CREATE OR REPLACE FUNCTION public.claim_search_quality_items_v1(p_run_id uuid, p_limit integer, p_lease_seconds integer DEFAULT 300)
RETURNS SETOF public.search_quality_items
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH picked AS (
    SELECT i.id FROM public.search_quality_items i
    JOIN public.search_quality_runs r ON r.id = i.run_id AND r.status = 'open'
    WHERE i.run_id = p_run_id
      AND i.attempts < 3
      AND (i.lease_until IS NULL OR i.lease_until < now())
      AND i.status IN ('pending', 'claimed')
    ORDER BY i.created_at, i.id
    LIMIT greatest(1, least(coalesce(p_limit, 1), 20))
    FOR UPDATE OF i SKIP LOCKED
  )
  UPDATE public.search_quality_items i
     SET status = 'claimed', attempts = i.attempts + 1,
         lease_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 300), 900))),
         updated_at = now()
    FROM picked WHERE i.id = picked.id
  RETURNING i.*;
$$;
REVOKE ALL ON FUNCTION public.claim_search_quality_items_v1(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_search_quality_items_v1(uuid, integer, integer) TO service_role;

-- The first baseline used a judge prompt that applied the recency rule to every query; discard it.
UPDATE public.search_quality_runs SET status = 'cancelled', completed_at = now()
 WHERE id = 'abf4f1c4-6475-4a23-8865-6fe9c253cf66' AND status = 'open';