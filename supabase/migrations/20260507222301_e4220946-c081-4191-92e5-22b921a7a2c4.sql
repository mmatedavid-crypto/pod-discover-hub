
REVOKE EXECUTE ON FUNCTION public.set_incremental_refresh_schedule(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_rss_hunter_schedule(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_title_cleanup_schedule(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reap_ai_stale_locks(int) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reap_deep_hydration_stale(int) FROM anon, authenticated;
