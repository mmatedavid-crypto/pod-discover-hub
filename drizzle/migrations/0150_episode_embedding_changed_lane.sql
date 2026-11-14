-- C) Episode search vectors: refresh only when the actual embedding input changed (content hash),
-- and embed short-but-final episodes the content guard accepts.
ALTER TABLE public.episode_embeddings ADD COLUMN IF NOT EXISTS content_checked_at timestamptz;
COMMENT ON COLUMN public.episode_embeddings.content_checked_at IS 'Last time the runner rebuilt the input and found the same content_hash (no re-embed needed).';

-- Missing lane v3: final clean-text states only (done with the verified deterministic_v4 row, or
-- skipped = nothing to clean); the length guard lives in embeddingSkipReason (title/summary/topics
-- count), so a short legitimate description is not padded and not excluded by SQL.
CREATE OR REPLACE FUNCTION public.select_embed_episode_candidates_v3(_limit integer)
 RETURNS TABLE(id uuid, podcast_id uuid, title text, display_title text, seo_description text, ai_summary text, topics text[], people text[], companies text[], tickers text[], ingredients text[], podcast_title text, podcast_display_title text, podcast_category text, clean_text text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '20s'
AS $function$
  SELECT e.id, e.podcast_id, e.title, e.display_title, e.seo_description, e.ai_summary,
         e.topics, e.people, e.companies, e.tickers, e.ingredients,
         p.title, p.display_title, p.category, left(ct.cleaned_text, 1600)
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    LEFT JOIN public.episode_clean_text ct ON ct.episode_id = e.id AND ct.cleaner_method LIKE 'deterministic_v4%'
   WHERE p.language_decision = 'accept_hungarian'
     AND ((e.clean_text_status = 'done' AND ct.episode_id IS NOT NULL) OR e.clean_text_status = 'skipped')
     AND NOT EXISTS (SELECT 1 FROM public.episode_embeddings x WHERE x.episode_id = e.id)
     AND NOT EXISTS (SELECT 1 FROM public.episode_embedding_skips s WHERE s.episode_id = e.id AND s.next_attempt_at > now())
   ORDER BY e.published_at DESC NULLS LAST
   LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200)
$function$;
REVOKE ALL ON FUNCTION public.select_embed_episode_candidates_v3(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_embed_episode_candidates_v3(integer) TO service_role;

-- Changed lane: rows whose episode or clean text was touched after the vector was written or last
-- checked. The runner rebuilds the input and re-embeds only when the hash differs.
CREATE OR REPLACE FUNCTION public.select_changed_embed_episode_candidates_v1(_limit integer)
 RETURNS TABLE(id uuid, podcast_id uuid, title text, display_title text, seo_description text, ai_summary text, topics text[], people text[], companies text[], tickers text[], ingredients text[], podcast_title text, podcast_display_title text, podcast_category text, clean_text text, stored_hash text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '20s'
AS $function$
  SELECT e.id, e.podcast_id, e.title, e.display_title, e.seo_description, e.ai_summary,
         e.topics, e.people, e.companies, e.tickers, e.ingredients,
         p.title, p.display_title, p.category, left(ct.cleaned_text, 1600), x.content_hash
    FROM public.episode_embeddings x
    JOIN public.episodes e ON e.id = x.episode_id
    JOIN public.podcasts p ON p.id = e.podcast_id
    LEFT JOIN public.episode_clean_text ct ON ct.episode_id = e.id AND ct.cleaner_method LIKE 'deterministic_v4%'
   WHERE p.language_decision = 'accept_hungarian'
     AND ((e.clean_text_status = 'done' AND ct.episode_id IS NOT NULL) OR e.clean_text_status = 'skipped')
     AND GREATEST(COALESCE(ct.updated_at, '-infinity'::timestamptz), e.updated_at)
         > GREATEST(x.updated_at, COALESCE(x.content_checked_at, '-infinity'::timestamptz))
     AND NOT EXISTS (SELECT 1 FROM public.episode_embedding_skips s WHERE s.episode_id = e.id AND s.next_attempt_at > now())
   ORDER BY e.published_at DESC NULLS LAST
   LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200)
$function$;
REVOKE ALL ON FUNCTION public.select_changed_embed_episode_candidates_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_changed_embed_episode_candidates_v1(integer) TO service_role;