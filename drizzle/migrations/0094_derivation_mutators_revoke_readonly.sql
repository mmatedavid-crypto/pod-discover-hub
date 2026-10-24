-- Defense in depth (as 0089 for catch-up): the read-only audit role must not run any
-- SECURITY DEFINER mutator of jobs / derivation state. Only service_role (and the owner,
-- incl. definer-to-definer internal calls) keep EXECUTE.
REVOKE EXECUTE ON FUNCTION public.fail_seo_job_terminal_v1(uuid, text, jsonb, jsonb) FROM readonly_codex;
REVOKE EXECUTE ON FUNCTION public.retry_failed_seo_derivations_v1(uuid[]) FROM readonly_codex;
REVOKE EXECUTE ON FUNCTION public.mark_episode_derivation_v1(text, jsonb) FROM readonly_codex;
REVOKE EXECUTE ON FUNCTION public.dispatch_stale_derivations_v1(integer, boolean) FROM readonly_codex;
REVOKE EXECUTE ON FUNCTION public.derivation_lock_decide_v1(text, uuid, text) FROM readonly_codex;
REVOKE EXECUTE ON FUNCTION public.derivation_apply_outcome_v1(text, uuid, text, text, text, text, text, boolean) FROM readonly_codex;
REVOKE EXECUTE ON FUNCTION public.apply_episode_seo_result_v1(uuid, text, text, jsonb) FROM readonly_codex;
REVOKE EXECUTE ON FUNCTION public.apply_episode_entities_v1(uuid, text, jsonb, text, text) FROM readonly_codex;
REVOKE EXECUTE ON FUNCTION public.apply_episode_topics_v1(uuid, text, jsonb, integer) FROM readonly_codex;

-- Caller guard on the two new top-level terminal-write RPCs (same guard as catch-up start/end:
-- service_role JWT, internal postgres session, or a JWT admin; never definer ownership).
DO $mig$
DECLARE f text; d text; a text := E'BEGIN\n';
  g text := E'BEGIN\n  IF NOT public.pipeline_catchup_caller_allowed_v1() THEN RAISE EXCEPTION ''not allowed'' USING ERRCODE = ''42501''; END IF;\n';
BEGIN
  FOREACH f IN ARRAY ARRAY['public.fail_seo_job_terminal_v1(uuid,text,jsonb,jsonb)', 'public.retry_failed_seo_derivations_v1(uuid[])'] LOOP
    d := pg_get_functiondef(f::regprocedure);
    IF position('pipeline_catchup_caller_allowed_v1' in d) > 0 THEN CONTINUE; END IF;
    IF position(a in d) = 0 THEN RAISE EXCEPTION 'BEGIN not found in %', f; END IF;
    d := overlay(d placing g from position(a in d) for length(a));
    EXECUTE d;
  END LOOP;
END $mig$;