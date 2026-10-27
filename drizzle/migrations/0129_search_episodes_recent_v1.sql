CREATE OR REPLACE FUNCTION public.search_episodes_recent_v1(
  q text,
  q_embedding vector DEFAULT NULL::vector,
  p_since timestamptz DEFAULT (now() - interval '90 days'),
  limit_n integer DEFAULT 60,
  lang text DEFAULT 'hu'::text,
  alpha_lex numeric DEFAULT 0.45
)
RETURNS TABLE(episode_id uuid, score numeric, lex_rank integer, sem_rank integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH
  ts AS (SELECT websearch_to_tsquery('simple', unaccent(coalesce(q, ''))) AS tsq),
  recent_ids AS MATERIALIZED (
    SELECT coalesce(array_agg(e.id), ARRAY[]::uuid[]) AS ids
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE e.published_at >= GREATEST(coalesce(p_since, now() - interval '90 days'), now() - interval '400 days')
      AND e.published_at <= now() + interval '1 day'
      AND (lang IS NULL OR p.language ILIKE lang || '%')
      AND (p.featured OR p.rss_status IS NULL OR p.rss_status NOT IN ('failed','inactive'))
  ),
  lex AS (
    SELECT e.id, ts_rank_cd(e.search_tsv, (SELECT tsq FROM ts)) AS r
    FROM public.episodes e
    WHERE e.id = ANY ((SELECT ids FROM recent_ids)::uuid[])
      AND e.search_tsv @@ (SELECT tsq FROM ts)
    ORDER BY r DESC, e.id
    LIMIT 200
  ),
  lex_ranked AS (SELECT id, row_number() OVER (ORDER BY r DESC, id) AS rk FROM lex),
  sem AS (
    SELECT ee.episode_id AS id,
           row_number() OVER (ORDER BY ee.embedding::halfvec(768) <=> q_embedding::halfvec(768), ee.episode_id) AS rk
    FROM public.episode_embeddings ee
    WHERE q_embedding IS NOT NULL
      AND ee.episode_id = ANY ((SELECT ids FROM recent_ids)::uuid[])
    ORDER BY ee.embedding::halfvec(768) <=> q_embedding::halfvec(768), ee.episode_id
    LIMIT 200
  )
  SELECT coalesce(l.id, s.id) AS episode_id,
         ( coalesce(alpha_lex, 0.45) * (CASE WHEN l.rk IS NOT NULL THEN 1.0/(60+l.rk) ELSE 0 END)
         + (1.0 - coalesce(alpha_lex, 0.45)) * (CASE WHEN s.rk IS NOT NULL THEN 1.0/(60+s.rk) ELSE 0 END)
         )::numeric AS score,
         coalesce(l.rk, 0)::int AS lex_rank,
         coalesce(s.rk, 0)::int AS sem_rank
  FROM lex_ranked l
  FULL OUTER JOIN sem s ON s.id = l.id
  ORDER BY score DESC, episode_id
  LIMIT GREATEST(1, LEAST(coalesce(limit_n, 60), 200));
$function$;

REVOKE ALL ON FUNCTION public.search_episodes_recent_v1(text, vector, timestamptz, integer, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_episodes_recent_v1(text, vector, timestamptz, integer, text, numeric) TO service_role;