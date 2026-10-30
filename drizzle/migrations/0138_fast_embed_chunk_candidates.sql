-- Chunk-embedding candidate lookups: find episodes without chunks FIRST (cheap anti-join on
-- small columns), then apply the expensive length(trim(cleaned_text)) check only to those few.
-- The old shape detoasted every clean text (~150k) on each call and hit the 8s statement
-- timeout when many background jobs started at the same minute. Same result set, same order.
CREATE OR REPLACE FUNCTION public.embed_chunks_candidate_stats(_model text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH miss AS MATERIALIZED (
    SELECT ct.episode_id
    FROM public.episode_clean_text ct
    WHERE ct.cleaner_method LIKE 'deterministic_v4%'
      AND NOT EXISTS (SELECT 1 FROM public.episode_chunks c WHERE c.episode_id = ct.episode_id AND c.model = _model)
  )
  SELECT jsonb_build_object(
    'missing', (SELECT count(*) FROM (
       SELECT 1 FROM miss m
       JOIN public.episodes e ON e.id = m.episode_id
       JOIN public.podcasts p ON p.id = e.podcast_id
       JOIN public.episode_clean_text ct ON ct.episode_id = m.episode_id
       WHERE p.language_decision = 'accept_hungarian'
         AND p.shadow_rank_tier IN ('S','A','B','C','D')
         AND length(trim(ct.cleaned_text)) >= 80
       LIMIT 20001) x),
    'waiting_for_clean_text', 0,
    'source_policy', 'all_age_capped_v3'
  );
$function$;

CREATE OR REPLACE FUNCTION public.select_embed_chunks_candidates(_model text, _limit integer)
 RETURNS TABLE(id uuid, podcast_id uuid, title text, display_title text, ai_summary text, description text, cleaned_text text, clean_source_hash text, cleaner_method text, transcript_model text, transcript_segments jsonb, transcript_hash text, topics text[], people text[], companies text[], tickers text[], ingredients text[], podcast_title text, podcast_display_title text, podcast_language text, podcast_tier text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH miss AS MATERIALIZED (
    SELECT ct.episode_id
    FROM public.episode_clean_text ct
    WHERE ct.cleaner_method LIKE 'deterministic_v4%'
      AND NOT EXISTS (SELECT 1 FROM public.episode_chunks c WHERE c.episode_id = ct.episode_id AND c.model = _model)
  ),
  cand AS (
    SELECT e.id, p.shadow_rank_tier AS tier, e.published_at
    FROM miss m
    JOIN public.episodes e ON e.id = m.episode_id
    JOIN public.podcasts p ON p.id = e.podcast_id
    JOIN public.episode_clean_text ct ON ct.episode_id = m.episode_id
    WHERE p.language_decision = 'accept_hungarian'
      AND p.shadow_rank_tier IN ('S','A','B','C','D')
      AND length(trim(ct.cleaned_text)) >= 80
    ORDER BY e.published_at DESC NULLS LAST
    LIMIT GREATEST(1, LEAST(_limit, 200))
  )
  SELECT e.id, e.podcast_id, e.title, e.display_title, e.ai_summary, e.description,
    ct.cleaned_text, ct.source_hash, ct.cleaner_method,
    bt.model, bt.segments, bt.content_hash,
    e.topics, e.people, e.companies, e.tickers, e.ingredients,
    p.title, p.display_title, p.language, p.shadow_rank_tier
  FROM cand
  JOIN public.episodes e ON e.id = cand.id
  JOIN public.podcasts p ON p.id = e.podcast_id
  JOIN public.episode_clean_text ct ON ct.episode_id = e.id
  LEFT JOIN LATERAL (
    SELECT tr.model, tr.segments, tr.content_hash
    FROM public.episode_transcripts tr
    WHERE tr.episode_id = e.id AND tr.status = 'ok'
      AND tr.content_hash = ct.source_hash
      AND jsonb_typeof(tr.segments) = 'array' AND jsonb_array_length(tr.segments) > 0
    ORDER BY CASE WHEN tr.model = 'supadata-youtube' THEN 0 WHEN tr.model = 'rss_audio_asr' THEN 1
      WHEN tr.model LIKE 'rss_podcast_transcript_tag:%' THEN 2 ELSE 9 END, tr.updated_at DESC NULLS LAST
    LIMIT 1
  ) bt ON true
  ORDER BY CASE cand.tier WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,
    cand.published_at DESC NULLS LAST;
$function$;