-- D) Hungarian word stems and small typos: an unknown search word is completed only to a word
-- that really occurs in the indexed catalog (prefix first, then a close spelling of the same stem).
CREATE OR REPLACE FUNCTION public.complete_unknown_tokens_v1(p_tokens text[])
RETURNS TABLE(token text, suggestion text, kind text, similarity real)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '2s'
AS $function$
DECLARE
  t text; stem text; s text; sim real;
BEGIN
  IF p_tokens IS NULL THEN RETURN; END IF;
  FOREACH t IN ARRAY p_tokens[1:4] LOOP
    t := lower(btrim(t));
    IF t !~ '^[a-z]{5,30}$' THEN CONTINUE; END IF;
    -- 1) the word is the start of an indexed word (hipervigil -> hipervigilancia)
    SELECT w INTO s FROM (
      SELECT w, count(*) c FROM (
        SELECT unnest(tsvector_to_array(e.search_tsv)) w
        FROM (SELECT search_tsv FROM public.episodes WHERE search_tsv @@ to_tsquery('simple', t || ':*') LIMIT 30) e
      ) x WHERE w LIKE t || '%' AND w <> t GROUP BY w ORDER BY c DESC, length(w) LIMIT 1
    ) y;
    IF s IS NOT NULL THEN
      token := t; suggestion := s; kind := 'prefix'; similarity := public.similarity(s, t); RETURN NEXT; CONTINUE;
    END IF;
    -- 2) a close spelling sharing the first letters (bhikkuh -> bhikkhu)
    stem := left(t, greatest(4, length(t) - 2));
    SELECT w, public.similarity(w, t) INTO s, sim FROM (
      SELECT DISTINCT unnest(tsvector_to_array(e.search_tsv)) w
      FROM (SELECT search_tsv FROM public.episodes WHERE search_tsv @@ to_tsquery('simple', stem || ':*') LIMIT 50) e
    ) x WHERE w LIKE stem || '%' AND w <> t ORDER BY public.similarity(w, t) DESC LIMIT 1;
    IF s IS NOT NULL AND sim >= 0.45 THEN
      token := t; suggestion := s; kind := 'close_spelling'; similarity := sim; RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_unknown_tokens_v1(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_unknown_tokens_v1(text[]) TO service_role;