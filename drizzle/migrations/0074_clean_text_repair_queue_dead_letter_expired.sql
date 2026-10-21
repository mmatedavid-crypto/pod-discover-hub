-- Rows whose lease expired after max_attempts (runs that crashed before
-- completing) become dead letters instead of being reclaimed forever.
CREATE OR REPLACE FUNCTION public.claim_clean_text_repair_queue_v1(p_owner text, p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 600)
RETURNS TABLE(episode_id uuid, repair_kind text, source_fingerprint text, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(p_owner, '') = '' THEN RAISE EXCEPTION 'owner required'; END IF;
  UPDATE public.clean_text_repair_queue q
    SET status = 'dead', outcome = 'lease_expired_max_attempts', lease_owner = NULL, lease_until = NULL,
        resolved_at = now(), updated_at = now()
  WHERE q.status = 'leased' AND q.lease_until < now() AND q.attempts >= q.max_attempts;
  RETURN QUERY
  WITH c AS (
    SELECT q.episode_id FROM public.clean_text_repair_queue q
    WHERE (q.status IN ('pending','retry') AND q.next_attempt_at <= now())
       OR (q.status = 'leased' AND q.lease_until < now())
    ORDER BY q.priority, q.published_at DESC NULLS LAST, q.episode_id
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.clean_text_repair_queue q
    SET status = 'leased', lease_owner = p_owner,
        lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 600), 60), 3600)),
        attempts = q.attempts + 1, updated_at = now()
  FROM c WHERE q.episode_id = c.episode_id
  RETURNING q.episode_id, q.repair_kind, q.source_fingerprint, q.attempts;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_clean_text_repair_queue_v1(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_clean_text_repair_queue_v1(text, integer, integer) TO service_role;
