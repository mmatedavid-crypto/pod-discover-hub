
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
  ts AS (SELECT websearch_to_tsquery('simple', coalesce(q,'')) AS tsq),
  lex AS (
    SELECT e.id, ts_rank_cd(e.search_tsv, (SELECT tsq FROM ts)) AS r
    FROM public.episodes e
    WHERE e.search_tsv @@ (SELECT tsq FROM ts)
    ORDER BY r DESC
    LIMIT 200
  ),
  lex_ranked AS (
    SELECT id, row_number() OVER (ORDER BY r DESC) AS rk FROM lex
  ),
  sem AS (
    SELECT ee.episode_id AS id,
           row_number() OVER (ORDER BY ee.embedding <=> q_embedding) AS rk
    FROM public.episode_embeddings ee
    WHERE q_embedding IS NOT NULL
    ORDER BY ee.embedding <=> q_embedding
    LIMIT 100
  ),
  fused AS (
    SELECT
      coalesce(l.id, s.id) AS id,
      l.rk AS lex_rk,
      s.rk AS sem_rk,
      (CASE WHEN l.rk IS NOT NULL THEN 1.0/(60+l.rk) ELSE 0 END
       + CASE WHEN s.rk IS NOT NULL THEN 1.0/(60+s.rk) ELSE 0 END) AS score
    FROM lex_ranked l
    FULL OUTER JOIN sem s ON s.id = l.id
  ),
  filtered AS (
    SELECT f.id, f.score, f.lex_rk, f.sem_rk
    FROM fused f
    JOIN public.episodes e ON e.id = f.id
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE (lang IS NULL OR p.language IS NULL OR p.language ILIKE lang || '%')
      AND (p.featured OR p.rss_status IS NULL OR p.rss_status NOT IN ('failed','inactive'))
  )
  SELECT id AS episode_id, score::numeric, coalesce(lex_rk,0)::int, coalesce(sem_rk,0)::int
  FROM filtered
  ORDER BY score DESC
  LIMIT limit_n;
$$;
