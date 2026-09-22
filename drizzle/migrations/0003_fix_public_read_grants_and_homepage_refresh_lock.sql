-- 1) Missing Data API read grants for tables whose RLS policies already allow public reads
GRANT SELECT ON public.episode_ai_classifications TO anon, authenticated;
GRANT SELECT ON public.episode_chunks TO anon, authenticated;
GRANT SELECT ON public.taste_cards TO anon, authenticated;
GRANT SELECT ON public.te_podiverzumod_shares TO anon, authenticated;

-- 2) Homepage MV refresh: never let two refreshes stack up (IO saturation caused
--    visitor queries to hit the 3s statement timeout and render as "no episodes").
CREATE OR REPLACE FUNCTION public.refresh_homepage_feed()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT pg_try_advisory_lock(918273645) THEN
    RAISE NOTICE 'refresh_homepage_feed already running, skipping';
    RETURN;
  END IF;
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_feed;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_evergreen;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(918273645);
    RAISE;
  END;
  PERFORM pg_advisory_unlock(918273645);
END;
$function$;

-- 3) Relax cadence from every 5 minutes to every 20 minutes
SELECT cron.alter_job(12, schedule := '*/20 * * * *');
