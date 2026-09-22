-- Smaller batches + a longer per-statement budget so each prune step finishes.
CREATE OR REPLACE FUNCTION public.prune_ai_call_audit(_keep_days integer DEFAULT 7, _batch integer DEFAULT 50000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '110s'
AS $$
DECLARE deleted integer;
BEGIN
  IF NOT pg_try_advisory_lock(918273645) THEN
    RETURN -1;
  END IF;
  DELETE FROM public.ai_call_audit
  WHERE ctid IN (
    SELECT ctid FROM public.ai_call_audit
    WHERE created_at < now() - make_interval(days => _keep_days)
    LIMIT _batch
  );
  GET DIAGNOSTICS deleted = ROW_COUNT;
  PERFORM pg_advisory_unlock(918273645);
  RETURN deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_call_audit_drain_tick()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  n := public.prune_ai_call_audit(7, 50000);
  IF n = 0 THEN
    PERFORM cron.unschedule('podiverzum-ai-audit-drain');
  END IF;
  RETURN n;
END;
$$;
