-- Reddit link bot retired 2026-10-26 (owner decision; it never posted). Tables are kept
-- only until the published admin page is gone, then dropped.
COMMENT ON TABLE public.reddit_bot_log IS 'DEPRECATED: Reddit link bot retired 2026-10-26; drop after publish';
COMMENT ON TABLE public.reddit_bot_opt_out IS 'DEPRECATED: Reddit link bot retired 2026-10-26; drop after publish';
DELETE FROM public.app_settings WHERE key = 'reddit_link_bot_controls';

-- Podcast similarity v2 state.
ALTER TABLE public.podcast_embeddings
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rec_group text,
  ADD COLUMN IF NOT EXISTS top_topics text[],
  ADD COLUMN IF NOT EXISTS checked_at timestamptz;

-- ivfflat(lists=100) on ~1.6k rows probed a single list, so most true neighbours were
-- never considered. Exact search over this small table is cheap.
DROP INDEX IF EXISTS public.podcast_embeddings_embedding_cos_idx;

CREATE TABLE IF NOT EXISTS public.podcast_embedding_failures (
  podcast_id uuid PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.podcast_embedding_failures TO service_role;
ALTER TABLE public.podcast_embedding_failures ENABLE ROW LEVEL SECURITY;

-- Due set: every accepted, healthy HU podcast without a current-version embedding, plus
-- periodic re-checks (re-embedded only when the content hash really changed).
CREATE OR REPLACE FUNCTION public.podcast_embed_due_v2(_version integer DEFAULT 2, _refresh_days integer DEFAULT 14)
RETURNS TABLE(id uuid, reason text, ord integer, rank_order integer, podiverzum_rank numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.id,
         CASE WHEN e.podcast_id IS NULL THEN 'missing'
              WHEN e.content_version < _version THEN 'outdated'
              ELSE 'recheck' END,
         CASE WHEN e.podcast_id IS NULL THEN 0 WHEN e.content_version < _version THEN 1 ELSE 2 END,
         coalesce(array_position(ARRAY['S','A','B','C','D','E']::text[], p.rank_label), 9),
         p.podiverzum_rank
    FROM public.podcasts p
    LEFT JOIN public.podcast_embeddings e ON e.podcast_id = p.id
    LEFT JOIN public.podcast_embedding_failures f ON f.podcast_id = p.id
   WHERE p.language_decision = 'accept_hungarian'
     AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN
         ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam')
     AND (f.podcast_id IS NULL OR (f.attempts < 5 AND f.next_attempt_at <= now()))
     AND (e.podcast_id IS NULL
          OR e.content_version < _version
          OR coalesce(e.checked_at, e.updated_at) < now() - make_interval(days => _refresh_days));
$$;

CREATE OR REPLACE FUNCTION public.select_podcast_embed_candidates_v2(_limit integer DEFAULT 60, _version integer DEFAULT 2, _refresh_days integer DEFAULT 14)
RETURNS TABLE(id uuid, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT d.id, d.reason FROM public.podcast_embed_due_v2(_version, _refresh_days) d
   ORDER BY d.ord, d.rank_order, d.podiverzum_rank DESC NULLS LAST
   LIMIT greatest(1, least(_limit, 200));
$$;

-- Public-safe inputs only: podcast metadata, RSS episode titles, topic labels (never transcript).
CREATE OR REPLACE FUNCTION public.get_podcast_embedding_inputs_v2(_ids uuid[])
RETURNS TABLE(id uuid, title text, category text, description text, map_topics text[], card_topics text[], recent_titles text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.id,
         coalesce(nullif(p.display_title,''), p.title),
         p.category,
         left(coalesce(p.description, ''), 2000),
         coalesce(mt.v, ARRAY[]::text[]),
         coalesce(ct.v, ARRAY[]::text[]),
         coalesce(rt.v, ARRAY[]::text[])
    FROM public.podcasts p
    LEFT JOIN LATERAL (
      SELECT array_agg(z.n ORDER BY z.c DESC, z.n) AS v FROM (
        SELECT t.name AS n, count(*) AS c
          FROM (SELECT ec.episode_id FROM public.episode_cards ec WHERE ec.podcast_id = p.id
                 ORDER BY ec.published_at DESC NULLS LAST LIMIT 100) r
          JOIN public.episode_topic_map m ON m.episode_id = r.episode_id
          JOIN public.topics t ON t.id = m.topic_id
         GROUP BY t.name ORDER BY count(*) DESC, t.name LIMIT 10) z
    ) mt ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(y.n ORDER BY y.c DESC, y.n) AS v FROM (
        SELECT lower(btrim(tp)) AS n, count(*) AS c
          FROM (SELECT ec.topics FROM public.episode_cards ec WHERE ec.podcast_id = p.id
                 ORDER BY ec.published_at DESC NULLS LAST LIMIT 100) r,
               unnest(coalesce(r.topics, ARRAY[]::text[])) tp
         WHERE btrim(tp) <> ''
         GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 15) y
    ) ct ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(x.title ORDER BY x.published_at DESC NULLS LAST) AS v FROM (
        SELECT ec.title, ec.published_at FROM public.episode_cards ec
         WHERE ec.podcast_id = p.id AND coalesce(ec.title,'') <> ''
         ORDER BY ec.published_at DESC NULLS LAST LIMIT 15) x
    ) rt ON true
   WHERE p.id = ANY(_ids);
$$;

REVOKE ALL ON FUNCTION public.podcast_embed_due_v2(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.select_podcast_embed_candidates_v2(integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_podcast_embedding_inputs_v2(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.podcast_embed_due_v2(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.select_podcast_embed_candidates_v2(integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_podcast_embedding_inputs_v2(uuid[]) TO service_role;

-- Controller backlog for embed_podcast = the runner's own due set.
CREATE OR REPLACE FUNCTION public.count_pipeline_pending(kind text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n bigint := 0;
BEGIN
  IF kind = 'clean_text_pending' THEN
    SELECT count(*) INTO n FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
    WHERE e.clean_text_status='pending' AND p.language_decision='accept_hungarian';
  ELSIF kind = 'embed_podcast_pending' THEN
    SELECT count(*) INTO n FROM public.podcast_embed_due_v2();
  ELSIF kind = 'seo_jobs_pending' THEN
    SELECT count(*) INTO n FROM ai_enrichment_jobs WHERE status = 'pending';
  ELSIF kind = 'ai_categorize_pending' THEN
    SELECT count(*) INTO n
    FROM podcasts
    WHERE category IS NULL
      AND shadow_rank_tier IN ('S','A','B','C')
      AND language_decision = 'accept_hungarian';
  ELSIF kind = 'episode_classifier_pending' THEN
    SELECT count(*) INTO n
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE p.language_decision = 'accept_hungarian'
      AND p.rank_label IN ('S','A','B','C')
      AND e.ai_summary IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM episode_ai_classifications c
        WHERE c.episode_id = e.id AND c.taxonomy_version = 'v1'
      );
  ELSIF kind = 'entity_backfill_pending' THEN
    SELECT count(*) INTO n
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE (e.ai_entities_version IS NULL OR e.ai_entities_version < 5)
      AND e.clean_text_status = 'done'
      AND p.language_decision = 'accept_hungarian';
  END IF;
  RETURN COALESCE(n, 0);
END;
$function$;

-- Similar podcasts v2: exact neighbours, verified-HU only, same compatibility rules as the
-- episode recommenders (science never next to esoteric/true-crime, cross-group needs ≥2
-- shared topics), active D-tier shows allowed with a smaller boost.
CREATE OR REPLACE FUNCTION public.get_similar_podcasts_by_embedding(p_podcast_id uuid, p_limit integer DEFAULT 8)
RETURNS TABLE(id uuid, similarity double precision, final_score double precision, title text, display_title text, slug text, summary text, description text, image_url text, category text, apple_url text, spotify_url text, youtube_url text, website_url text, featured boolean, rss_status text, podiverzum_rank numeric, rank_label text, episode_count integer, latest_episode_at timestamp with time zone)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '8s'
AS $function$
DECLARE
  src_embedding vector(768);
  src_group text;
  src_topics text[];
BEGIN
  SELECT pe.embedding,
         coalesce(pe.rec_group, public.recommendation_text_group(NULL, coalesce(p.display_title, p.title), p.category, pe.top_topics)),
         coalesce(pe.top_topics, ARRAY[]::text[])
    INTO src_embedding, src_group, src_topics
    FROM podcast_embeddings pe JOIN podcasts p ON p.id = pe.podcast_id
   WHERE pe.podcast_id = p_podcast_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH cand AS (
    SELECT p.*, (1 - (pe.embedding <=> src_embedding))::float AS sim,
           coalesce(pe.rec_group, public.recommendation_text_group(NULL, coalesce(p.display_title, p.title), p.category, pe.top_topics)) AS grp,
           coalesce((SELECT count(*) FROM unnest(coalesce(pe.top_topics, ARRAY[]::text[])) t WHERE t = ANY(src_topics)), 0)::int AS shared
    FROM podcast_embeddings pe
    JOIN podcasts p ON p.id = pe.podcast_id
    WHERE pe.podcast_id <> p_podcast_id
      AND p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND COALESCE(p.rss_status,'healthy') NOT IN ('failed','inactive')
      AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN
          ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam')
      AND COALESCE(p.rank_label,'E') IN ('S','A','B','C','D')
    ORDER BY pe.embedding <=> src_embedding
    LIMIT 80
  ),
  compat AS (
    SELECT c.* FROM cand c
     WHERE c.sim >= 0.55
       AND public.recommendation_is_compatible_v2(src_group, c.grp, c.sim, c.shared, false)
  ),
  stats AS (
    SELECT c.*, agg.ep_count, agg.last_ep_at
    FROM compat c
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS ep_count, max(ec.published_at) AS last_ep_at
      FROM episode_cards ec WHERE ec.podcast_id = c.id
    ) agg ON true
  )
  SELECT
    s.id, s.sim,
    (
      s.sim
      + least(s.shared, 4) * 0.015
      + CASE s.rank_label WHEN 'S' THEN 0.06 WHEN 'A' THEN 0.04 WHEN 'B' THEN 0.02 WHEN 'C' THEN 0.01 ELSE 0 END
      + CASE WHEN s.last_ep_at > now() - interval '60 days' THEN 0.03 ELSE 0 END
      + CASE WHEN s.ep_count >= 20 THEN 0.01 ELSE 0 END
    )::float AS fscore,
    s.title, s.display_title, s.slug, s.summary, s.description,
    s.image_url, s.category, s.apple_url, s.spotify_url, s.youtube_url, s.website_url,
    s.featured, s.rss_status, s.podiverzum_rank, s.rank_label,
    coalesce(s.ep_count, 0), s.last_ep_at
  FROM stats s
  WHERE s.rank_label <> 'D' OR s.last_ep_at > now() - interval '120 days'
  ORDER BY fscore DESC
  LIMIT GREATEST(LEAST(p_limit, 24), 1);
END;
$function$;
