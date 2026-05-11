
-- Batch dedup by (podcast_id, guid)
CREATE OR REPLACE FUNCTION public.dedup_episodes_guid_batch(_batch int DEFAULT 2000)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  WITH dups AS (
    SELECT id
    FROM (
      SELECT id, row_number() OVER (PARTITION BY podcast_id, guid ORDER BY created_at, id) AS rn
      FROM public.episodes
      WHERE guid IS NOT NULL
    ) t
    WHERE rn > 1
    LIMIT _batch
  )
  DELETE FROM public.episodes e USING dups d WHERE e.id = d.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Batch dedup by (podcast_id, audio_url) where guid is null
CREATE OR REPLACE FUNCTION public.dedup_episodes_audio_url_batch(_batch int DEFAULT 2000)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  WITH dups AS (
    SELECT id
    FROM (
      SELECT id, row_number() OVER (PARTITION BY podcast_id, audio_url ORDER BY created_at, id) AS rn
      FROM public.episodes
      WHERE guid IS NULL AND audio_url IS NOT NULL
    ) t
    WHERE rn > 1
    LIMIT _batch
  )
  DELETE FROM public.episodes e USING dups d WHERE e.id = d.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.dedup_episodes_guid_batch(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dedup_episodes_audio_url_batch(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dedup_episodes_guid_batch(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.dedup_episodes_audio_url_batch(int) TO service_role;
