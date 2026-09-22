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
