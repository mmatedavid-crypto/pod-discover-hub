-- These lookups return clean text and transcript segments for background embedding only.
-- They must never be callable from the browser (anon key is public).
REVOKE ALL ON FUNCTION public.select_embed_chunks_candidates(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.embed_chunks_candidate_stats(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_embed_chunks_candidates(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.embed_chunks_candidate_stats(text) TO service_role;