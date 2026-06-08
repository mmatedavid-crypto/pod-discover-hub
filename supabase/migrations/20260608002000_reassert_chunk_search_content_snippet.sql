-- Surface a short transcript chunk snippet next to timestamped search hits.
-- The embedding input stores stable episode context before CONTENT; public search
-- results should expose only the matched content portion.

DROP FUNCTION IF EXISTS public.search_episode_chunks(vector, integer, integer);

CREATE OR REPLACE FUNCTION public.search_episode_chunks(
  query_embedding vector(768),
  match_count integer DEFAULT 30,
  candidate_pool integer DEFAULT 400
)
RETURNS TABLE (
  episode_id uuid,
  similarity double precision,
  best_source text,
  chunk_idx integer,
  content_snippet text,
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
      left(
        regexp_replace(
          btrim(COALESCE(NULLIF(split_part(ec.content, E'\nCONTENT:\n', 2), ''), ec.content)),
          '[[:space:]]+',
          ' ',
          'g'
        ),
        420
      ) AS content_snippet,
      ec.timestamp_start_seconds,
      ec.timestamp_end_seconds,
      ec.segment_start_idx,
      ec.segment_end_idx,
      ec.source_transcript_model,
      ec.chunking_method,
      (1 - (ec.embedding <=> query_embedding))::double precision AS sim
    FROM public.episode_chunks ec
    WHERE ec.content IS NOT NULL
    ORDER BY ec.embedding <=> query_embedding
    LIMIT GREATEST(1, LEAST(candidate_pool, 1000))
  ),
  ranked AS (
    SELECT
      episode_id,
      sim,
      chunk_idx,
      content_snippet,
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
    content_snippet,
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
  'episode_chunk_search_result_policy',
  jsonb_build_object(
    'version', 'timestamp_chunk_search_v3_content_snippet',
    'content_snippet_max_chars', 420,
    'content_snippet_source', 'episode_chunks.content after CONTENT marker',
    'search_result_fields', jsonb_build_array('content_snippet', 'timestamp_start_seconds', 'timestamp_end_seconds', 'segment_start_idx', 'segment_end_idx', 'source_transcript_model', 'chunking_method'),
    'reasserted_by', '20260608002000_reassert_chunk_search_content_snippet'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = now();
