-- Defense in depth: the read-only audit role must not hold EXECUTE on catch-up write functions
-- (its caller guard already returns false for it).
REVOKE ALL ON FUNCTION public.start_pipeline_catchup_v1(integer, text) FROM readonly_codex;
REVOKE ALL ON FUNCTION public.end_pipeline_catchup_v1() FROM readonly_codex;
REVOKE ALL ON FUNCTION public.pipeline_catchup_tick_v1(boolean) FROM readonly_codex;
REVOKE ALL ON FUNCTION public.pipeline_catchup_restore_group_v1(jsonb, text, text) FROM readonly_codex;