-- Vectors written before the embedding route moved to the AI gateway (2026-09-22) live in a
-- different vector space than today's query vectors; this lane re-embeds them, newest first,
-- only when embed_episode_controls.reembed_before is set by the owner.
CREATE OR REPLACE FUNCTION public.select_reembed_episode_candidates_v1(_before timestamptz, _limit integer)
RETURNS TABLE(id uuid, podcast_id uuid, title text, display_title text, seo_description text, ai_summary text,
  topics text[], people text[], companies text[], tickers text[], ingredients text[],
  podcast_title text, podcast_display_title text, podcast_category text, clean_text text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '20s'
AS $$
  SELECT e.id, e.podcast_id, e.title, e.display_title, e.seo_description, e.ai_summary,
         e.topics, e.people, e.companies, e.tickers, e.ingredients,
         p.title, p.display_title, p.category, left(ct.cleaned_text, 1600)
    FROM public.episode_embeddings x
    JOIN public.episodes e ON e.id = x.episode_id
    JOIN public.podcasts p ON p.id = e.podcast_id
    JOIN public.episode_clean_text ct ON ct.episode_id = e.id AND ct.cleaner_method LIKE 'deterministic_v4%'
   WHERE x.updated_at < _before
     AND p.language_decision = 'accept_hungarian'
     AND e.clean_text_status = 'done'
     AND length(ct.cleaned_text) >= 80
     AND NOT EXISTS (SELECT 1 FROM public.episode_embedding_skips s WHERE s.episode_id = e.id AND s.next_attempt_at > now())
   ORDER BY e.published_at DESC NULLS LAST
   LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200)
$$;
REVOKE ALL ON FUNCTION public.select_reembed_episode_candidates_v1(timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_reembed_episode_candidates_v1(timestamptz, integer) TO service_role;