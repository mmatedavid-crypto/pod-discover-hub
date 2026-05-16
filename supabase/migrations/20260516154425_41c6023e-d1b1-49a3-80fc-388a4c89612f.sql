-- v13 search engine port from remix (Podiverzum project)
-- Adds: token_df_cache + token_idf, suggest_token_corrections, entity_profiles,
-- topic_hubs (no EN seed — HU seed to come separately), resolve_query_entities,
-- search_hyde_cache, match_podcast_by_name, and the new 9-arg
-- search_episodes_hybrid(required_terms, entity_terms, alpha_lex, phrase_terms,
-- p_decay_lambda).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =========================================================================
-- 1) token_df_cache + token_idf RPC (IDF rare-token MUST gate)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.token_df_cache (
  token text PRIMARY KEY,
  df bigint NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.token_df_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "token_df_cache public read" ON public.token_df_cache;
CREATE POLICY "token_df_cache public read" ON public.token_df_cache
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "token_df_cache admin write" ON public.token_df_cache;
CREATE POLICY "token_df_cache admin write" ON public.token_df_cache
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS token_df_cache_token_trgm_idx
  ON public.token_df_cache USING gin (token gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.token_idf(p_tokens text[])
RETURNS TABLE(token text, df bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    INSERT INTO public.token_df_cache (token, df, computed_at)
    VALUES (t, cnt, now())
    ON CONFLICT (token) DO UPDATE
      SET df = EXCLUDED.df, computed_at = EXCLUDED.computed_at;

    token := t; df := cnt; RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.token_idf(text[]) TO anon, authenticated, service_role;

-- =========================================================================
-- 2) suggest_token_corrections RPC (spell correction)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.suggest_token_corrections(p_tokens text[])
RETURNS TABLE(token text, suggestion text, similarity real, df bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
  rec record;
BEGIN
  IF p_tokens IS NULL OR array_length(p_tokens, 1) IS NULL THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY p_tokens LOOP
    t := lower(btrim(t));
    IF length(t) < 4 OR length(t) > 30 THEN CONTINUE; END IF;
    SELECT c.token AS suggestion, similarity(c.token, t) AS sim, c.df
      INTO rec
      FROM public.token_df_cache c
     WHERE c.df >= 50
       AND c.token <> t
       AND c.token % t
     ORDER BY similarity(c.token, t) DESC, c.df DESC
     LIMIT 1;
    IF rec IS NOT NULL AND rec.sim >= 0.6 THEN
      token := t; suggestion := rec.suggestion; similarity := rec.sim; df := rec.df;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_token_corrections(text[]) TO anon, authenticated, service_role;

-- =========================================================================
-- 3) entity_profiles table
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.entity_profiles (
  kind text NOT NULL,
  slug text NOT NULL,
  display_name text NOT NULL,
  bio text,
  episodes_summary text,
  episode_ids uuid[] NOT NULL DEFAULT '{}',
  featured_episode_ids uuid[] NOT NULL DEFAULT '{}',
  appearance_stats jsonb NOT NULL DEFAULT '{}',
  model text,
  cost_usd numeric,
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, slug)
);

ALTER TABLE public.entity_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entity_profiles public read" ON public.entity_profiles;
CREATE POLICY "entity_profiles public read" ON public.entity_profiles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "entity_profiles admin write" ON public.entity_profiles;
CREATE POLICY "entity_profiles admin write" ON public.entity_profiles
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_entity_profiles_updated_at
  ON public.entity_profiles(updated_at DESC);
CREATE INDEX IF NOT EXISTS entity_profiles_display_name_trgm
  ON public.entity_profiles USING gin (lower(display_name) gin_trgm_ops);

-- =========================================================================
-- 4) topic_hubs table (empty — HU seed will be loaded separately)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.topic_hubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  category text,
  accent_hsl text,
  aliases text[] NOT NULL DEFAULT '{}',
  bio text,
  episodes_summary text,
  episode_ids uuid[] NOT NULL DEFAULT '{}',
  featured_episode_ids uuid[] NOT NULL DEFAULT '{}',
  appearance_stats jsonb NOT NULL DEFAULT '{}',
  model text,
  cost_usd numeric DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  generated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topic_hubs_aliases_gin
  ON public.topic_hubs USING gin (aliases);
CREATE INDEX IF NOT EXISTS idx_topic_hubs_active
  ON public.topic_hubs (active, sort_order);
CREATE INDEX IF NOT EXISTS topic_hubs_title_trgm
  ON public.topic_hubs USING gin (lower(title) gin_trgm_ops);

ALTER TABLE public.topic_hubs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "topic_hubs public read" ON public.topic_hubs;
CREATE POLICY "topic_hubs public read" ON public.topic_hubs FOR SELECT USING (true);

DROP POLICY IF EXISTS "topic_hubs admin write" ON public.topic_hubs;
CREATE POLICY "topic_hubs admin write" ON public.topic_hubs FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- =========================================================================
-- 5) resolve_query_entities RPC
-- =========================================================================
CREATE OR REPLACE FUNCTION public.resolve_query_entities(
  p_q text,
  p_max int DEFAULT 6,
  p_threshold real DEFAULT 0.45
)
RETURNS TABLE(kind text, display_name text, slug text, similarity real)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (SELECT lower(btrim(p_q)) AS qn),
  ep AS (
    SELECT ep.kind::text AS kind, ep.display_name, ep.slug,
           similarity(lower(ep.display_name), (SELECT qn FROM q)) AS sim
    FROM public.entity_profiles ep, q
    WHERE lower(ep.display_name) % q.qn
  ),
  th AS (
    SELECT 'topic'::text AS kind, th.title AS display_name, th.slug,
           GREATEST(
             similarity(lower(th.title), (SELECT qn FROM q)),
             COALESCE((
               SELECT MAX(similarity(lower(a), (SELECT qn FROM q)))
               FROM unnest(th.aliases) AS a
             ), 0)
           ) AS sim
    FROM public.topic_hubs th, q
    WHERE th.active
      AND (lower(th.title) % q.qn
           OR EXISTS (SELECT 1 FROM unnest(th.aliases) a WHERE lower(a) % q.qn))
  ),
  uni AS (
    SELECT * FROM ep
    UNION ALL
    SELECT * FROM th
  )
  SELECT kind, display_name, slug, sim::real
  FROM uni
  WHERE sim >= p_threshold
  ORDER BY sim DESC
  LIMIT p_max;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_query_entities(text, int, real)
  TO anon, authenticated, service_role;

-- =========================================================================
-- 6) match_podcast_by_name RPC (HU-only filter)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.match_podcast_by_name(
  p_q text,
  p_max int DEFAULT 3,
  p_threshold float DEFAULT 0.45
)
RETURNS TABLE(podcast_id uuid, title text, slug text, similarity real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH q AS (SELECT btrim(p_q) AS qn)
  SELECT p.id, p.title, p.slug,
         similarity(p.title, (SELECT qn FROM q))::real AS sim
  FROM public.podcasts p
  WHERE p.title % (SELECT qn FROM q)
    AND p.language ILIKE 'hu%'
    AND p.rss_status NOT IN ('failed','inactive')
  ORDER BY sim DESC, p.podiverzum_rank DESC
  LIMIT p_max
$$;

GRANT EXECUTE ON FUNCTION public.match_podcast_by_name(text, int, float)
  TO anon, authenticated, service_role;

-- =========================================================================
-- 7) search_hyde_cache table
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.search_hyde_cache (
  q_norm text PRIMARY KEY,
  hyde_text text NOT NULL,
  embedding vector(768),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.search_hyde_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "search_hyde_cache public read" ON public.search_hyde_cache;
CREATE POLICY "search_hyde_cache public read"
  ON public.search_hyde_cache FOR SELECT USING (true);

DROP POLICY IF EXISTS "search_hyde_cache admin write" ON public.search_hyde_cache;
CREATE POLICY "search_hyde_cache admin write"
  ON public.search_hyde_cache FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_search_hyde_cache_created_at
  ON public.search_hyde_cache (created_at);

-- =========================================================================
-- 8) search_events telemetry column
-- =========================================================================
ALTER TABLE public.search_events
  ADD COLUMN IF NOT EXISTS confidence_band text;

-- =========================================================================
-- 9) Replace search_episodes_hybrid with the 9-arg v13 variant.
--    Drop ALL previous overloads first so PostgREST has no ambiguity.
-- =========================================================================
DROP FUNCTION IF EXISTS public.search_episodes_hybrid(text, vector, integer, text);
DROP FUNCTION IF EXISTS public.search_episodes_hybrid(text, vector, integer, text, text[], text[], numeric);
DROP FUNCTION IF EXISTS public.search_episodes_hybrid(text, vector, integer, text, text[], text[], numeric, text[]);
DROP FUNCTION IF EXISTS public.search_episodes_hybrid(text, vector, integer, text, text[], text[], numeric, text[], numeric);

CREATE OR REPLACE FUNCTION public.search_episodes_hybrid(
  q text,
  q_embedding vector DEFAULT NULL::vector,
  limit_n integer DEFAULT 50,
  lang text DEFAULT 'hu'::text,
  required_terms text[] DEFAULT NULL::text[],
  entity_terms text[] DEFAULT NULL::text[],
  alpha_lex numeric DEFAULT 0.5,
  phrase_terms text[] DEFAULT NULL::text[],
  p_decay_lambda numeric DEFAULT 0
)
RETURNS TABLE(episode_id uuid, score numeric, lex_rank integer, sem_rank integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH
  ts AS (SELECT websearch_to_tsquery('simple', coalesce(q,'')) AS tsq),
  lex AS (
    SELECT e.id, ts_rank_cd(e.search_tsv, (SELECT tsq FROM ts)) AS r
    FROM public.episodes e
    WHERE e.search_tsv @@ (SELECT tsq FROM ts)
    ORDER BY r DESC
    LIMIT 300
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
    LIMIT 200
  ),
  fused AS (
    SELECT
      coalesce(l.id, s.id) AS id,
      l.rk AS lex_rk,
      s.rk AS sem_rk,
      ( coalesce(alpha_lex, 0.5) * (CASE WHEN l.rk IS NOT NULL THEN 1.0/(60+l.rk) ELSE 0 END)
      + (1.0 - coalesce(alpha_lex, 0.5)) * (CASE WHEN s.rk IS NOT NULL THEN 1.0/(60+s.rk) ELSE 0 END)
      ) AS base_score
    FROM lex_ranked l
    FULL OUTER JOIN sem s ON s.id = l.id
  ),
  with_boost AS (
    SELECT
      f.id, f.lex_rk, f.sem_rk,
      f.base_score
        + CASE
            WHEN entity_terms IS NOT NULL
             AND array_length(entity_terms, 1) IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM unnest(
                      coalesce(e.topics,ARRAY[]::text[])
                   || coalesce(e.people,ARRAY[]::text[])
                   || coalesce(e.companies,ARRAY[]::text[])
                   || coalesce(e.tickers,ARRAY[]::text[])
                   || coalesce(e.ingredients,ARRAY[]::text[])
                    ) AS u(tag),
                    unnest(entity_terms) AS et(term)
               WHERE length(btrim(et.term)) >= 2
                 AND lower(u.tag) = lower(btrim(et.term))
             )
            THEN 0.05
            ELSE 0
          END
        + CASE
            WHEN phrase_terms IS NOT NULL
             AND array_length(phrase_terms, 1) IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM unnest(phrase_terms) AS pt(term)
               WHERE length(btrim(pt.term)) >= 3
                 AND lower(coalesce(e.title,'') || ' ' || coalesce(e.display_title,''))
                     LIKE ('%' || lower(btrim(pt.term)) || '%')
             )
            THEN 0.15
            ELSE 0
          END
        + CASE
            WHEN coalesce(p_decay_lambda, 0) > 0 AND e.published_at IS NOT NULL
            THEN coalesce(p_decay_lambda, 0)
                 * exp( -0.02 * GREATEST(0, EXTRACT(EPOCH FROM (now() - e.published_at)) / 86400.0) )
            ELSE 0
          END
        AS score
    FROM fused f
    JOIN public.episodes e ON e.id = f.id
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE (lang IS NULL OR p.language ILIKE lang || '%')
      AND (p.featured OR p.rss_status IS NULL OR p.rss_status NOT IN ('failed','inactive'))
      AND (
        required_terms IS NULL
        OR array_length(required_terms, 1) IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(required_terms) AS rt(term)
          WHERE length(btrim(rt.term)) >= 3
            AND lower(coalesce(e.search_text,'') || ' ' || coalesce(e.title,'') || ' ' || coalesce(e.display_title,''))
                !~* ('\m' || regexp_replace(lower(btrim(rt.term)), '([\.\*\+\?\(\)\[\]\{\}\|\^\$])', '\\\1', 'g') || '\M')
        )
      )
  )
  SELECT id AS episode_id, score::numeric, coalesce(lex_rk,0)::int, coalesce(sem_rk,0)::int
  FROM with_boost
  ORDER BY score DESC
  LIMIT limit_n;
$function$;

GRANT EXECUTE ON FUNCTION public.search_episodes_hybrid(
  text, vector, integer, text, text[], text[], numeric, text[], numeric
) TO anon, authenticated, service_role;