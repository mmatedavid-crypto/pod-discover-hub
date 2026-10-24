-- Security fix: inside SECURITY DEFINER current_user is the owner (postgres), so the previous
-- guard let every authenticated caller change global catch-up quotas. The caller is now
-- identified from the request JWT role (service_role) or, without any JWT, the session user
-- (pg_cron / internal postgres session); otherwise an admin JWT is required. EXECUTE is
-- revoked from authenticated: no UI starts or ends a catch-up.
CREATE OR REPLACE FUNCTION public.pipeline_catchup_caller_allowed_v1()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), v_claims->>'role');
  v_sub uuid := nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), v_claims->>'sub'), '')::uuid;
BEGIN
  IF v_role = 'service_role' THEN RETURN true; END IF;
  IF v_role IS NULL AND v_sub IS NULL AND session_user IN ('postgres', 'supabase_admin') THEN RETURN true; END IF;
  IF v_sub IS NOT NULL AND v_role = 'authenticated' THEN
    RETURN public.has_role(v_sub, 'admin'::public.app_role);
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.pipeline_catchup_caller_allowed_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pipeline_catchup_caller_allowed_v1() TO service_role;

DO $mig$
DECLARE d text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.start_pipeline_catchup_v1(integer,text)', 'public.end_pipeline_catchup_v1()'] LOOP
    d := pg_get_functiondef(f::regprocedure);
    IF position('IF NOT (current_user IN (''postgres'', ''service_role'', ''supabase_admin'') OR public.has_role(auth.uid(), ''admin''::public.app_role)) THEN' in d) = 0 THEN
      RAISE EXCEPTION 'guard not found in %', f;
    END IF;
    d := replace(d, 'IF NOT (current_user IN (''postgres'', ''service_role'', ''supabase_admin'') OR public.has_role(auth.uid(), ''admin''::public.app_role)) THEN',
                    'IF NOT public.pipeline_catchup_caller_allowed_v1() THEN');
    EXECUTE d;
  END LOOP;
END $mig$;

REVOKE ALL ON FUNCTION public.start_pipeline_catchup_v1(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_pipeline_catchup_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_pipeline_catchup_v1(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.end_pipeline_catchup_v1() TO service_role;

-- Derivation part of the catch-up ends only when nothing is eligible for dispatch AND nothing
-- dispatched is still queued in a runner (in-flight work counts as backlog).
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.pipeline_catchup_tick_v1(boolean)'::regprocedure);
  IF position('IF v_eligible = 0 THEN v_reason := ''eligible_backlog_empty''; END IF;' in d) = 0 THEN
    RAISE EXCEPTION 'tick condition not found';
  END IF;
  d := replace(d, 'IF v_eligible = 0 THEN v_reason := ''eligible_backlog_empty''; END IF;',
    'IF v_eligible = 0 AND NOT EXISTS (SELECT 1 FROM public.episode_derivation_state q
                                        WHERE q.entity_status = ''queued'' OR q.topic_status = ''queued'' OR q.seo_status = ''queued'') THEN
        v_reason := ''eligible_and_queued_backlog_empty'';
      END IF;');
  EXECUTE d;
END $mig$;