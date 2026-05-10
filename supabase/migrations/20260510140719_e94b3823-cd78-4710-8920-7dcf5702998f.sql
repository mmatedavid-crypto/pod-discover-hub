
CREATE OR REPLACE FUNCTION public.refresh_episodes_search_text_batch(_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH batch AS (
    SELECT e.id, e.podcast_id
    FROM public.episodes e
    LEFT JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE e.search_text IS NULL
       OR (p.title IS NOT NULL AND position(lower(unaccent(p.title)) IN coalesce(e.search_text,'')) = 0)
    LIMIT _limit
  ),
  joined AS (
    SELECT b.id,
      lower(unaccent(
        coalesce(e.display_title, e.title, '') || ' ' ||
        coalesce(e.ai_summary, '') || ' ' ||
        coalesce(e.summary, '') || ' ' ||
        coalesce(array_to_string(e.topics, ' '), '') || ' ' ||
        coalesce(array_to_string(e.people, ' '), '') || ' ' ||
        coalesce(array_to_string(e.companies, ' '), '') || ' ' ||
        coalesce(array_to_string(e.ingredients, ' '), '') || ' ' ||
        coalesce(array_to_string(e.tickers, ' '), '') || ' ' ||
        coalesce(p.display_title, p.title, '') || ' ' ||
        coalesce(p.category, '')
      )) AS new_text
    FROM batch b
    JOIN public.episodes e ON e.id = b.id
    LEFT JOIN public.podcasts p ON p.id = b.podcast_id
  ),
  upd AS (
    UPDATE public.episodes e
    SET search_text = j.new_text,
        search_tsv = to_tsvector('simple', j.new_text)
    FROM joined j
    WHERE e.id = j.id
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$$;
