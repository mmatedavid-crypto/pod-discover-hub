-- lovable-cron-fallback-reviewed: bounded one-off backlog drain of 46M audit rows; the tick unschedules itself when the backlog is empty, leaving only a nightly prune.
CREATE OR REPLACE FUNCTION public.prune_ai_call_audit(_keep_days integer DEFAULT 7, _batch integer DEFAULT 200000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE deleted integer;
BEGIN
  IF NOT pg_try_advisory_lock(918273645) THEN
    RETURN -1;
  END IF;
  DELETE FROM public.ai_call_audit
  WHERE id IN (
    SELECT id FROM public.ai_call_audit
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
  n := public.prune_ai_call_audit(7, 400000);
  IF n = 0 THEN
    PERFORM cron.unschedule('podiverzum-ai-audit-drain');
  END IF;
  RETURN n;
END;
$$;

SELECT cron.schedule('podiverzum-ai-audit-drain', '* * * * *', $$SELECT public.ai_call_audit_drain_tick();$$);
SELECT cron.schedule('podiverzum-prune-ai-call-audit', '25 3 * * *', $$SELECT public.prune_ai_call_audit(7, 500000);$$);

-- Social automation is intentionally disabled, so this daily job only produced failing calls.
SELECT cron.unschedule('podiverzum-daily-social-post-14utc');

COMMENT ON TABLE public.ai_call_audit IS 'AI call audit trail. Retention: 7 days (public.prune_ai_call_audit). Long-term cost history lives in public.ai_spend_daily.';
