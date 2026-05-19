CREATE OR REPLACE FUNCTION public.token_idf(p_tokens text[])
RETURNS TABLE(token text, df bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  t text;
  cnt bigint;
  cached_df bigint;
  cached_at timestamptz;
BEGIN
  FOREACH t IN ARRAY p_tokens LOOP
    t := lower(btrim(t));
    IF length(t) < 3 OR length(t) > 40 THEN CONTINUE; END IF;

    SELECT c.df, c.computed_at INTO cached_df, cached_at
    FROM public.token_df_cache c WHERE c.token = t;

    IF cached_df IS NOT NULL AND cached_at > now() - interval '7 days' THEN
      token := t; df := cached_df; RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      SELECT count(*)::bigint INTO cnt
      FROM (
        SELECT 1 FROM public.episodes
        WHERE search_tsv @@ plainto_tsquery('simple', t)
        LIMIT 1000
      ) s;
    EXCEPTION WHEN OTHERS THEN
      cnt := 1000;
    END;

    INSERT INTO public.token_df_cache AS c (token, df, computed_at)
    VALUES (t, cnt, now())
    ON CONFLICT ON CONSTRAINT token_df_cache_pkey DO UPDATE
      SET df = EXCLUDED.df, computed_at = EXCLUDED.computed_at;

    token := t; df := cnt; RETURN NEXT;
  END LOOP;
END;
$function$;