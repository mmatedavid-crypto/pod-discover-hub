
ALTER TABLE public.mood_collections
  ADD COLUMN IF NOT EXISTS seed_query text;

CREATE OR REPLACE FUNCTION public.match_podcasts_by_embedding(
  p_embedding vector,
  p_limit integer DEFAULT 8,
  p_lang text DEFAULT 'en',
  p_model text DEFAULT 'google/gemini-embedding-001'
)
RETURNS TABLE (
  id uuid,
  similarity double precision,
  title text,
  display_title text,
  slug text,
  image_url text,
  category text,
  shadow_rank_tier text,
  podiverzum_rank numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    1 - (pe.embedding <=> p_embedding) AS similarity,
    p.title,
    p.display_title,
    p.slug,
    p.image_url,
    p.category,
    p.shadow_rank_tier,
    p.podiverzum_rank
  FROM public.podcast_embeddings pe
  JOIN public.podcasts p ON p.id = pe.podcast_id
  WHERE pe.model = p_model
    AND (p_lang IS NULL OR p.language = p_lang)
    AND p.shadow_rank_tier IN ('S','A')
    AND p.rss_status IN ('active','ok','healthy','not_checked')
    AND COALESCE(p.quarantined_until, now()) <= now()
  ORDER BY pe.embedding <=> p_embedding ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.match_podcasts_by_embedding(vector, integer, text, text) TO anon, authenticated, service_role;
