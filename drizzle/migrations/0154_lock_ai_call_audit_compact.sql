REVOKE ALL ON FUNCTION public.ai_call_audit_compact() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_call_audit_compact() FROM anon;
REVOKE ALL ON FUNCTION public.ai_call_audit_compact() FROM authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.ai_call_audit_compact() FROM readonly_codex';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.ai_call_audit_compact() TO service_role;