-- 1) Fix search RPC: unaccent query + match terms against unaccented sources
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
  ts AS (SELECT websearch_to_tsquery('simple', unaccent(coalesce(q,''))) AS tsq),
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
                 AND lower(unaccent(u.tag)) = lower(unaccent(btrim(et.term)))
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
                 AND lower(unaccent(coalesce(e.title,'') || ' ' || coalesce(e.display_title,'')))
                     LIKE ('%' || lower(unaccent(btrim(pt.term))) || '%')
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
            AND lower(unaccent(coalesce(e.search_text,'') || ' ' || coalesce(e.title,'') || ' ' || coalesce(e.display_title,'')))
                !~* ('\m' || regexp_replace(lower(unaccent(btrim(rt.term))), '([\.\*\+\?\(\)\[\]\{\}\|\^\$])', '\\\1', 'g') || '\M')
        )
      )
  )
  SELECT id AS episode_id, score::numeric, coalesce(lex_rk,0)::int, coalesce(sem_rk,0)::int
  FROM with_boost
  ORDER BY score DESC
  LIMIT limit_n;
$function$;

-- 2) Cleanup of all non-Hungarian (reject_foreign) podcast data
DO $cleanup$
DECLARE
  v_pod RECORD;
  v_ep_count int;
  v_emb_count int;
  v_ai_count int;
BEGIN
  FOR v_pod IN
    SELECT id, title, rss_url, detected_language, hungarian_score, foreign_score
    FROM public.podcasts
    WHERE language_decision = 'reject_foreign'
  LOOP
    -- counts for audit
    SELECT count(*) INTO v_ep_count FROM public.episodes WHERE podcast_id = v_pod.id;
    SELECT count(*) INTO v_emb_count FROM public.episode_embeddings WHERE podcast_id = v_pod.id;
    SELECT count(*) INTO v_ai_count FROM public.ai_enrichment_jobs
      WHERE (target_type = 'podcast' AND target_id = v_pod.id)
         OR (target_type = 'episode' AND target_id IN (SELECT id FROM public.episodes WHERE podcast_id = v_pod.id));

    -- delete episode-scoped derived data
    DELETE FROM public.episode_chunks WHERE podcast_id = v_pod.id;
    DELETE FROM public.episode_embeddings WHERE podcast_id = v_pod.id;
    DELETE FROM public.episode_clean_text WHERE episode_id IN (SELECT id FROM public.episodes WHERE podcast_id = v_pod.id);
    DELETE FROM public.episode_transcripts WHERE podcast_id = v_pod.id;
    DELETE FROM public.episode_topic_map WHERE episode_id IN (SELECT id FROM public.episodes WHERE podcast_id = v_pod.id);
    DELETE FROM public.episode_youtube_links WHERE podcast_id = v_pod.id;
    DELETE FROM public.person_episode_mentions WHERE podcast_id = v_pod.id;

    -- AI jobs
    DELETE FROM public.ai_enrichment_jobs
      WHERE (target_type = 'podcast' AND target_id = v_pod.id)
         OR (target_type = 'episode' AND target_id IN (SELECT id FROM public.episodes WHERE podcast_id = v_pod.id));

    -- episodes
    DELETE FROM public.episodes WHERE podcast_id = v_pod.id;

    -- podcast-scoped derived data
    DELETE FROM public.podcast_embeddings WHERE podcast_id = v_pod.id;
    DELETE FROM public.podcast_boilerplate_blocks WHERE podcast_id = v_pod.id;
    DELETE FROM public.podcast_topic_map WHERE podcast_id = v_pod.id;
    DELETE FROM public.podcast_youtube_candidates WHERE podcast_id = v_pod.id;
    DELETE FROM public.podcast_language_review_queue WHERE podcast_id = v_pod.id;
    DELETE FROM public.person_podcast_map WHERE podcast_id = v_pod.id;
    DELETE FROM public.rss_url_history WHERE podcast_id = v_pod.id;

    -- audit log entry
    INSERT INTO public.podcast_language_cleanup_log(
      podcast_id, title, rss_url, detected_language, hungarian_score, foreign_score,
      deletion_reason, deleted_related_episode_count, deleted_embedding_count, deleted_ai_job_count, evidence
    ) VALUES (
      v_pod.id, v_pod.title, v_pod.rss_url, v_pod.detected_language, v_pod.hungarian_score, v_pod.foreign_score,
      'reject_foreign_bulk_cleanup_2026_05_17', v_ep_count, v_emb_count, v_ai_count,
      jsonb_build_object('language_decision','reject_foreign','triggered_by','manual_bulk_cleanup')
    );

    -- finally the podcast itself
    DELETE FROM public.podcasts WHERE id = v_pod.id;
  END LOOP;
END;
$cleanup$;