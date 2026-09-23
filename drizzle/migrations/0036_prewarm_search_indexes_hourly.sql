-- The semantic-search indexes must stay in the page cache; a cold lookup costs
-- 10-18s, a warm one under 1s. This reconciliation job reloads them once an hour
-- (and after any restart), which is the only time they can fall out of cache.
CREATE OR REPLACE FUNCTION public.prewarm_search_indexes()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '5min'
AS $$
DECLARE total bigint := 0; idx text;
BEGIN
  FOREACH idx IN ARRAY ARRAY[
    'idx_episode_embeddings_hnsw_half',
    'idx_episode_chunks_hnsw_half',
    'idx_episodes_search_tsv',
    'idx_podcasts_search_tsv'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=idx) THEN
      total := total + pg_prewarm('public.' || idx, 'read');
    END IF;
  END LOOP;
  RETURN 'blocks=' || total;
END;
$$;

REVOKE ALL ON FUNCTION public.prewarm_search_indexes() FROM public;
GRANT EXECUTE ON FUNCTION public.prewarm_search_indexes() TO service_role;

SELECT cron.schedule('podiverzum-prewarm-search-indexes', '7 * * * *', $$SELECT public.prewarm_search_indexes();$$);
