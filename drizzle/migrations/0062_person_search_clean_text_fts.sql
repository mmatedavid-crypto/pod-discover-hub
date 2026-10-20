-- Indexed full-name candidate lookup in cleaned episode text for person search.
-- Replaces a synchronous ILIKE '%name%' sequential scan (mean ~2s, max ~7.8s).
CREATE INDEX IF NOT EXISTS idx_episode_clean_text_simple_fts
  ON public.episode_clean_text USING gin (to_tsvector('simple'::regconfig, cleaned_text));

CREATE OR REPLACE FUNCTION public.search_clean_text_name_candidates(p_tsquery text, p_limit integer DEFAULT 200)
RETURNS TABLE(episode_id uuid, cleaned_text text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT c.episode_id, c.cleaned_text
  FROM public.episode_clean_text c
  WHERE to_tsvector('simple'::regconfig, c.cleaned_text) @@ to_tsquery('simple'::regconfig, p_tsquery)
    AND c.cleaner_method LIKE 'deterministic_v4%'
  LIMIT least(greatest(coalesce(p_limit, 200), 1), 300)
$$;

REVOKE ALL ON FUNCTION public.search_clean_text_name_candidates(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_clean_text_name_candidates(text, integer) TO service_role;

COMMENT ON FUNCTION public.search_clean_text_name_candidates(text, integer) IS
  'Server-only candidate retrieval for full-name search; results must be verified by the full-name matcher. Not identity evidence.';