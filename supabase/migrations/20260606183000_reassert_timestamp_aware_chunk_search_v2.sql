-- Reassert timestamp-aware chunk search after later bundled migrations that
-- recreate the embedding RPCs with older return contracts.

ALTER TABLE public.episode_chunks
  ADD COLUMN IF NOT EXISTS timestamp_start_seconds integer,
  ADD COLUMN IF NOT EXISTS timestamp_end_seconds integer,
  ADD COLUMN IF NOT EXISTS segment_start_idx integer,
  ADD COLUMN IF NOT EXISTS segment_end_idx integer,
  ADD COLUMN IF NOT EXISTS source_transcript_model text,
  ADD COLUMN IF NOT EXISTS chunking_method text NOT NULL DEFAULT 'char_window_v1';

CREATE INDEX IF NOT EXISTS episode_chunks_timestamp_idx
  ON public.episode_chunks (episode_id, timestamp_start_seconds)
  WHERE timestamp_start_seconds IS NOT NULL;

DROP FUNCTION IF EXISTS public.select_embed_chunks_candidates(text, integer);

CREATE FUNCTION public.select_embed_chunks_candidates(_model text, _limit integer)
RETURNS TABLE(
  id uuid,
  podcast_id uuid,
  title text,
  display_title text,
  ai_summary text,
  description text,
  cleaned_text text,
  clean_source_hash text,
  cleaner_method text,
  transcript_model text,
  transcript_segments jsonb,
  transcript_hash text,
  topics text[],
  people text[],
  companies text[],
  tickers text[],
  ingredients text[],
  podcast_title text,
  podcast_display_title text,
  podcast_language text,
  podcast_tier text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH done AS (
    SELECT episode_id
    FROM public.episode_chunks
    WHERE model = _model
    GROUP BY episode_id
  ),
  best_transcript AS (
    SELECT DISTINCT ON (tr.episode_id)
      tr.episode_id,
      tr.model,
      tr.segments,
      tr.content_hash
    FROM public.episode_transcripts tr
    WHERE tr.status = 'ok'
      AND jsonb_typeof(tr.segments) = 'array'
      AND jsonb_array_length(tr.segments) > 0
    ORDER BY
      tr.episode_id,
      CASE
        WHEN tr.model = 'supadata-youtube' THEN 0
        WHEN tr.model = 'rss_audio_asr' THEN 1
        WHEN tr.model LIKE 'rss_podcast_transcript_tag:%' THEN 2
        ELSE 9
      END,
      tr.updated_at DESC NULLS LAST
  )
  SELECT
    e.id,
    e.podcast_id,
    e.title,
    e.display_title,
    e.ai_summary,
    e.description,
    ct.cleaned_text,
    ct.source_hash,
    ct.cleaner_method,
    bt.model AS transcript_model,
    bt.segments AS transcript_segments,
    bt.content_hash AS transcript_hash,
    e.topics,
    e.people,
    e.companies,
    e.tickers,
    e.ingredients,
    p.title,
    p.display_title,
    p.language,
    p.shadow_rank_tier
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  JOIN public.episode_clean_text ct ON ct.episode_id = e.id
  LEFT JOIN best_transcript bt ON bt.episode_id = e.id
    AND bt.content_hash = ct.source_hash
  WHERE p.language_decision = 'accept_hungarian'
    AND p.shadow_rank_tier IN ('S','A','B','C','D')
    AND ct.cleaner_method LIKE 'deterministic_v4%'
    AND length(trim(ct.cleaned_text)) >= 80
    AND NOT EXISTS (SELECT 1 FROM done d WHERE d.episode_id = e.id)
  ORDER BY
    CASE p.shadow_rank_tier WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,
    e.published_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(_limit, 200));
$function$;

GRANT EXECUTE ON FUNCTION public.select_embed_chunks_candidates(text, integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.embed_chunks_candidate_stats(_model text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH clean_eligible AS (
    SELECT e.id
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    JOIN public.episode_clean_text ct ON ct.episode_id = e.id
    WHERE p.language_decision = 'accept_hungarian'
      AND p.shadow_rank_tier IN ('S','A','B','C','D')
      AND ct.cleaner_method LIKE 'deterministic_v4%'
      AND length(trim(ct.cleaned_text)) >= 80
  ),
  waiting AS (
    SELECT e.id
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE p.language_decision = 'accept_hungarian'
      AND p.shadow_rank_tier IN ('S','A','B','C','D')
      AND COALESCE(e.description,'') <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.episode_clean_text ct
        WHERE ct.episode_id = e.id
          AND ct.cleaner_method LIKE 'deterministic_v4%'
          AND length(trim(ct.cleaned_text)) >= 80
      )
  ),
  done AS (
    SELECT episode_id
    FROM public.episode_chunks
    WHERE model = _model
    GROUP BY episode_id
  )
  SELECT jsonb_build_object(
    'eligible_total', (SELECT count(*) FROM clean_eligible),
    'waiting_for_clean_text', (SELECT count(*) FROM waiting),
    'already_chunked', (SELECT count(*) FROM clean_eligible e WHERE EXISTS (SELECT 1 FROM done d WHERE d.episode_id = e.id)),
    'missing', (SELECT count(*) FROM clean_eligible e WHERE NOT EXISTS (SELECT 1 FROM done d WHERE d.episode_id = e.id)),
    'total_chunks', (SELECT count(*) FROM public.episode_chunks WHERE model = _model),
    'source_policy', 'best_source_then_deterministic_v4_family_clean_text_then_timestamp_aware_embedding'
  );
$function$;

GRANT EXECUTE ON FUNCTION public.embed_chunks_candidate_stats(text) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.search_episode_chunks(vector, integer, integer);

CREATE FUNCTION public.search_episode_chunks(
  query_embedding vector(768),
  match_count integer DEFAULT 30,
  candidate_pool integer DEFAULT 400
)
RETURNS TABLE (
  episode_id uuid,
  similarity double precision,
  best_source text,
  chunk_idx integer,
  timestamp_start_seconds integer,
  timestamp_end_seconds integer,
  segment_start_idx integer,
  segment_end_idx integer,
  source_transcript_model text,
  chunking_method text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH cand AS (
    SELECT
      ec.episode_id,
      ec.chunk_idx,
      ec.timestamp_start_seconds,
      ec.timestamp_end_seconds,
      ec.segment_start_idx,
      ec.segment_end_idx,
      ec.source_transcript_model,
      ec.chunking_method,
      (1 - (ec.embedding <=> query_embedding))::double precision AS sim
    FROM public.episode_chunks ec
    ORDER BY ec.embedding <=> query_embedding
    LIMIT GREATEST(1, LEAST(candidate_pool, 1000))
  ),
  ranked AS (
    SELECT
      episode_id,
      sim,
      chunk_idx,
      timestamp_start_seconds,
      timestamp_end_seconds,
      segment_start_idx,
      segment_end_idx,
      source_transcript_model,
      chunking_method,
      ROW_NUMBER() OVER (PARTITION BY episode_id ORDER BY sim DESC) AS rn
    FROM cand
  )
  SELECT
    episode_id,
    sim AS similarity,
    'chunk'::text AS best_source,
    chunk_idx,
    timestamp_start_seconds,
    timestamp_end_seconds,
    segment_start_idx,
    segment_end_idx,
    source_transcript_model,
    chunking_method
  FROM ranked
  WHERE rn = 1
  ORDER BY sim DESC
  LIMIT GREATEST(1, LEAST(match_count, 100));
$function$;

GRANT EXECUTE ON FUNCTION public.search_episode_chunks(vector, integer, integer) TO anon, authenticated, service_role;

INSERT INTO public.app_settings(key, value, updated_at)
VALUES (
  'episode_chunking_policy',
  jsonb_build_object(
    'version', 'timestamp_aware_v2',
    'search_contract_version', 'timestamp_chunk_search_v2',
    'preferred_source', 'episode_transcripts.segments when transcript content_hash matches episode_clean_text.source_hash',
    'fallback', 'char_window_v1',
    'target_words', jsonb_build_object('min', 150, 'max', 250, 'overlap', 50),
    'search_result_fields', jsonb_build_array('timestamp_start_seconds', 'timestamp_end_seconds', 'segment_start_idx', 'segment_end_idx', 'source_transcript_model', 'chunking_method'),
    'clean_text_gate', 'deterministic_v4_family',
    'language_gate', 'podcasts.language_decision=accept_hungarian',
    'reasserted_by', '20260606183000_reassert_timestamp_aware_chunk_search_v2'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

DO $$
DECLARE
  v_candidates_def text;
  v_search_result text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_candidates_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'select_embed_chunks_candidates'
    AND oidvectortypes(p.proargtypes) = 'text, integer'
  LIMIT 1;

  SELECT pg_get_function_result(p.oid)
  INTO v_search_result
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'search_episode_chunks'
    AND oidvectortypes(p.proargtypes) = 'vector, integer, integer'
  LIMIT 1;

  IF v_candidates_def IS NULL
     OR v_candidates_def NOT ILIKE '%transcript_segments jsonb%'
     OR v_candidates_def NOT ILIKE '%bt.content_hash = ct.source_hash%'
     OR v_candidates_def NOT ILIKE '%ct.cleaner_method LIKE ''deterministic_v4%%''%'
     OR v_candidates_def ILIKE ('%' || 'p.is_hungarian' || ' = true%') THEN
    RAISE EXCEPTION 'timestamp-aware chunk candidate RPC must keep clean-text gate, matched transcript segments, and no legacy HU flag';
  END IF;

  IF v_search_result IS NULL
     OR v_search_result NOT ILIKE '%timestamp_start_seconds integer%'
     OR v_search_result NOT ILIKE '%source_transcript_model text%'
     OR v_search_result NOT ILIKE '%chunking_method text%' THEN
    RAISE EXCEPTION 'search_episode_chunks must return timestamp-aware chunk metadata';
  END IF;
END $$;
