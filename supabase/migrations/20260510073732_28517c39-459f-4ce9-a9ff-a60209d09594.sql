
CREATE OR REPLACE FUNCTION public.search_backfill_batch(_table text, _batch int DEFAULT 5000)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int := 0;
BEGIN
  IF _table = 'episodes' THEN
    WITH b AS (
      SELECT id FROM public.episodes WHERE search_text IS NULL LIMIT _batch FOR UPDATE SKIP LOCKED
    )
    UPDATE public.episodes e SET title = e.title FROM b WHERE e.id = b.id;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF _table = 'podcasts' THEN
    WITH b AS (
      SELECT id FROM public.podcasts WHERE search_text IS NULL LIMIT _batch FOR UPDATE SKIP LOCKED
    )
    UPDATE public.podcasts p SET title = p.title FROM b WHERE p.id = b.id;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'invalid table: %', _table;
  END IF;
  RETURN n;
END $$;

-- Add config block? not needed — verify_jwt false default for new functions.
