
-- Hybrid search RPC: combines lexical (websearch_to_tsquery on search_tsv) + trigram fallback
-- + optional semantic (cosine on episode_embeddings) using Reciprocal Rank Fusion.
CREATE OR REPLACE FUNCTION public.search_episodes_hybrid(
  q text,
  q_embedding vector(768) DEFAULT NULL,
  limit_n int DEFAULT 50,
  lang text DEFAULT 'en'
)
RETURNS TABLE (
  episode_id uuid,
  score numeric,
  lex_rank int,
  sem_rank int
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH
  ts AS (
    SELECT websearch_to_tsquery('simple', coalesce(q,'')) AS tsq
  ),
  lex AS (
    SELECT e.id,
           ts_rank_cd(e.search_tsv, (SELECT tsq FROM ts)) AS r
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE e.search_tsv @@ (SELECT tsq FROM ts)
      AND (lang IS NULL OR p.language IS NULL OR p.language ILIKE lang || '%')
      AND (p.rss_status IS NULL OR p.rss_status NOT IN ('failed','inactive') OR p.featured)
    ORDER BY r DESC
    LIMIT 200
  ),
  trg AS (
    -- trigram fallback when ts has few hits (typos, partial words)
    SELECT e.id,
           similarity(e.search_text, lower(coalesce(q,''))) AS r
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE e.search_text % lower(coalesce(q,''))
      AND (lang IS NULL OR p.language IS NULL OR p.language ILIKE lang || '%')
      AND (p.rss_status IS NULL OR p.rss_status NOT IN ('failed','inactive') OR p.featured)
    ORDER BY r DESC
    LIMIT 100
  ),
  lex_union AS (
    SELECT id, max(r) AS r FROM (
      SELECT id, r FROM lex
      UNION ALL SELECT id, r FROM trg
    ) u GROUP BY id
  ),
  lex_ranked AS (
    SELECT id, row_number() OVER (ORDER BY r DESC) AS rk FROM lex_union
  ),
  sem AS (
    SELECT ee.episode_id AS id,
           row_number() OVER (ORDER BY ee.embedding <=> q_embedding) AS rk
    FROM public.episode_embeddings ee
    JOIN public.podcasts p ON p.id = ee.podcast_id
    WHERE q_embedding IS NOT NULL
      AND (lang IS NULL OR p.language IS NULL OR p.language ILIKE lang || '%')
      AND (p.rss_status IS NULL OR p.rss_status NOT IN ('failed','inactive') OR p.featured)
    ORDER BY ee.embedding <=> q_embedding
    LIMIT 100
  ),
  fused AS (
    SELECT
      coalesce(l.id, s.id) AS id,
      l.rk AS lex_rk,
      s.rk AS sem_rk,
      -- RRF, k=60
      (CASE WHEN l.rk IS NOT NULL THEN 1.0 / (60 + l.rk) ELSE 0 END
       + CASE WHEN s.rk IS NOT NULL THEN 1.0 / (60 + s.rk) ELSE 0 END) AS score
    FROM lex_ranked l
    FULL OUTER JOIN sem s ON s.id = l.id
  )
  SELECT id AS episode_id,
         score::numeric,
         coalesce(lex_rk, 0)::int AS lex_rank,
         coalesce(sem_rk, 0)::int AS sem_rank
  FROM fused
  ORDER BY score DESC
  LIMIT limit_n;
$$;

GRANT EXECUTE ON FUNCTION public.search_episodes_hybrid(text, vector, int, text) TO anon, authenticated, service_role;
