
CREATE OR REPLACE FUNCTION public.search_episode_chunks(
  query_embedding vector(768),
  match_count int DEFAULT 30,
  candidate_pool int DEFAULT 400
)
RETURNS TABLE (
  episode_id uuid,
  similarity float,
  best_source text,
  chunk_idx int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cand AS (
    SELECT
      ec.episode_id,
      ec.chunk_idx,
      1 - (ec.embedding <=> query_embedding) AS sim
    FROM public.episode_chunks ec
    ORDER BY ec.embedding <=> query_embedding
    LIMIT candidate_pool
  ),
  ranked AS (
    SELECT
      episode_id,
      sim,
      chunk_idx,
      ROW_NUMBER() OVER (PARTITION BY episode_id ORDER BY sim DESC) AS rn
    FROM cand
  )
  SELECT
    episode_id,
    sim AS similarity,
    'chunk'::text AS best_source,
    chunk_idx
  FROM ranked
  WHERE rn = 1
  ORDER BY sim DESC
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.search_episode_chunks(vector, int, int) TO anon, authenticated, service_role;
