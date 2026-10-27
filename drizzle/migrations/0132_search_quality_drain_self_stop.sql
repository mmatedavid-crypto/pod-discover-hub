-- The temporary drain schedule removes itself once no measurement run is open.
CREATE OR REPLACE FUNCTION public.stop_search_quality_drain_v1()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.search_quality_runs WHERE status = 'open') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'search-quality-eval-drain') THEN
    PERFORM cron.unschedule('search-quality-eval-drain');
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.stop_search_quality_drain_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stop_search_quality_drain_v1() TO service_role;