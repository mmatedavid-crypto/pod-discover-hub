
DROP FUNCTION IF EXISTS public.refresh_episodes_search_text_batch(integer);

CREATE OR REPLACE FUNCTION public.refresh_episodes_search_text_batch(_limit integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cursor timestamptz;
  v_max_seen timestamptz;
  v_count integer;
BEGIN
  SELECT (value->>'created_at')::timestamptz INTO v_cursor
  FROM public.app_settings WHERE key = 'search_text_backfill_cursor';
  IF v_cursor IS NULL THEN v_cursor := 'epoch'::timestamptz; END IF;

  WITH batch AS (
    SELECT e.id, e.podcast_id, e.created_at
    FROM public.episodes e
    WHERE e.created_at > v_cursor
    ORDER BY e.created_at ASC
    LIMIT _limit
  ),
  joined AS (
    SELECT b.id, b.created_at,
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
    RETURNING j.created_at
  )
  SELECT count(*), max(created_at) INTO v_count, v_max_seen FROM upd;

  IF v_count > 0 THEN
    INSERT INTO public.app_settings(key, value, updated_at)
    VALUES ('search_text_backfill_cursor', jsonb_build_object('created_at', v_max_seen), now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END IF;

  RETURN jsonb_build_object('updated', v_count, 'cursor', v_max_seen, 'done', v_count = 0);
END;
$$;
