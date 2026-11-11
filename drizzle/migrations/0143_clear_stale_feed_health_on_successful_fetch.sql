-- A feed marked rss_url_not_found / needs_manual_rss_review during a transient outage kept that
-- mark forever after the original feed started working again, so SEO enqueue, deep hydration,
-- sitemap and ranking kept treating live shows as broken. A successful fetch now clears it.
-- Reversible: the previous state is kept in shadow_rank_components.health_recovered.from.
CREATE OR REPLACE FUNCTION public.podcasts_clear_stale_feed_health_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  hs text := NEW.shadow_rank_components->>'health_state';
BEGIN
  IF hs IN ('rss_url_not_found', 'needs_manual_rss_review')
     AND NEW.rss_status = 'active'
     AND NEW.last_fetch_error IS NULL
     AND coalesce(NEW.consecutive_failure_count, 0) = 0
     AND NEW.last_fetched_at IS NOT NULL
     AND NEW.last_fetched_at IS DISTINCT FROM OLD.last_fetched_at THEN
    NEW.shadow_rank_components := NEW.shadow_rank_components
      || jsonb_build_object(
           'health_state', 'healthy',
           'health_recovered', jsonb_build_object(
             'from', hs, 'at', now(), 'reason', 'feed_fetch_ok', 'rss_url', NEW.rss_url));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.podcasts_clear_stale_feed_health_v1() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS podcasts_clear_stale_feed_health ON public.podcasts;
CREATE TRIGGER podcasts_clear_stale_feed_health
BEFORE UPDATE OF last_fetched_at ON public.podcasts
FOR EACH ROW EXECUTE FUNCTION public.podcasts_clear_stale_feed_health_v1();

-- One-time backfill: only shows whose current feed fetched cleanly after the mark was set.
UPDATE public.podcasts p
   SET shadow_rank_components = p.shadow_rank_components
     || jsonb_build_object(
          'health_state', 'healthy',
          'health_recovered', jsonb_build_object(
            'from', p.shadow_rank_components->>'health_state', 'at', now(),
            'reason', 'backfill_feed_fetch_ok_2026-11-11', 'rss_url', p.rss_url,
            'last_fetched_at', p.last_fetched_at))
 WHERE p.rss_status = 'active'
   AND p.shadow_rank_components->>'health_state' IN ('rss_url_not_found', 'needs_manual_rss_review')
   AND p.last_fetch_error IS NULL
   AND coalesce(p.consecutive_failure_count, 0) = 0
   AND p.last_fetched_at > coalesce(
         (p.shadow_rank_components->>'rss_rediscovery_attempted_at')::timestamptz,
         (p.shadow_rank_components->'rss_rediscovery_candidate'->>'at')::timestamptz,
         '1970-01-01'::timestamptz);