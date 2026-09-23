-- Transcript-chunk search now traverses the compact halfvec index (270 MB instead
-- of 541 MB), so it stays in the page cache. Similarity is still reported from the
-- full-precision vectors, so ranking is unchanged.
CREATE OR REPLACE FUNCTION public.search_episode_chunks(query_embedding vector, match_count integer DEFAULT 30, candidate_pool integer DEFAULT 400)
 RETURNS TABLE(episode_id uuid, similarity double precision, best_source text, chunk_idx integer, content_snippet text, timestamp_start_seconds integer, timestamp_end_seconds integer, segment_start_idx integer, segment_end_idx integer, source_transcript_model text, chunking_method text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
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
    ORDER BY ec.embedding::halfvec(768) <=> query_embedding::halfvec(768)
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

DROP FUNCTION IF EXISTS public.build_chunks_halfvec_once();
SELECT public.prewarm_search_indexes();
