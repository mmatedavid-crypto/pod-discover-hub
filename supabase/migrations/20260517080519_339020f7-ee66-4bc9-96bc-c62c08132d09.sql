CREATE OR REPLACE FUNCTION public.select_embed_chunks_candidates(_model text, _limit integer)
 RETURNS TABLE(id uuid, podcast_id uuid, title text, display_title text, ai_summary text, description text, topics text[], people text[], companies text[], tickers text[], ingredients text[], podcast_title text, podcast_display_title text, podcast_language text, podcast_tier text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH proper AS (
    SELECT episode_id
    FROM public.episode_chunks
    WHERE model = _model AND char_end > 0
    GROUP BY episode_id
  )
  SELECT e.id, e.podcast_id, e.title, e.display_title,
    e.ai_summary, e.description, e.topics, e.people, e.companies, e.tickers, e.ingredients,
    p.title, p.display_title, p.language, p.shadow_rank_tier
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  WHERE p.language ILIKE 'hu%'
    AND p.shadow_rank_tier IN ('S','A','B','C')
    AND NOT EXISTS (SELECT 1 FROM proper pr WHERE pr.episode_id = e.id)
  ORDER BY
    CASE p.shadow_rank_tier WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,
    e.published_at DESC NULLS LAST
  LIMIT _limit;
$function$;

CREATE OR REPLACE FUNCTION public.embed_chunks_candidate_stats(_model text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH eligible AS (
    SELECT e.id FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE p.language ILIKE 'hu%' AND p.shadow_rank_tier IN ('S','A','B','C')
  ),
  proper AS (
    SELECT episode_id FROM public.episode_chunks
    WHERE model = _model AND char_end > 0
    GROUP BY episode_id
  ),
  legacy AS (
    SELECT episode_id FROM public.episode_chunks
    WHERE model = _model
    GROUP BY episode_id
    HAVING max(char_end) = 0
  )
  SELECT jsonb_build_object(
    'eligible_total', (SELECT count(*) FROM eligible),
    'already_chunked', (SELECT count(*) FROM proper WHERE episode_id IN (SELECT id FROM eligible)),
    'legacy_backfill', (SELECT count(*) FROM legacy WHERE episode_id IN (SELECT id FROM eligible)),
    'missing', (SELECT count(*) FROM eligible WHERE id NOT IN (SELECT episode_id FROM proper)),
    'total_chunks', (SELECT count(*) FROM public.episode_chunks WHERE model = _model)
  );
$function$;