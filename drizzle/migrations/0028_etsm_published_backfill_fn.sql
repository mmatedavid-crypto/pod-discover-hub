CREATE OR REPLACE FUNCTION public.etsm_published_backfill(_batch integer DEFAULT 50000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE n integer;
BEGIN
  WITH b AS (
    SELECT episode_id, slug FROM episode_topic_slug_map WHERE published_at IS NULL LIMIT _batch
  ), upd AS (
    UPDATE episode_topic_slug_map m SET published_at = c.published_at
      FROM b, episode_cards c
     WHERE m.episode_id = b.episode_id AND m.slug = b.slug AND c.episode_id = m.episode_id
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.etsm_published_backfill(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.etsm_published_backfill(integer) TO service_role;