-- lovable-cron-fallback-reviewed: one-off backfill of the slim episode_cards projection; each tick copies 4000 rows and the job unschedules itself when the queue drains (~40 runs total)
CREATE OR REPLACE FUNCTION public.episode_cards_backfill_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '240s'
AS $$
DECLARE
  copied integer;
BEGIN
  copied := public.episode_cards_backfill(4000);
  IF copied = 0 THEN
    PERFORM cron.unschedule('episode-cards-backfill');
  END IF;
END;
$$;

SELECT cron.schedule('episode-cards-backfill', '* * * * *', $$SELECT public.episode_cards_backfill_tick();$$);