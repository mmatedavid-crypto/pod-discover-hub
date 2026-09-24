CREATE OR REPLACE FUNCTION public.search_episode_chunks(query_embedding vector, match_count integer DEFAULT 30, candidate_pool integer DEFAULT 400)
 RETURNS TABLE(episode_id uuid, similarity double precision, best_source text, chunk_idx integer, content_snippet text, timestamp_start_seconds integer, timestamp_end_seconds integer, segment_start_idx integer, segment_end_idx integer, source_transcript_model text, chunking_method text)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM set_config('hnsw.ef_search', GREATEST(40, LEAST(candidate_pool, 1000))::text, true);
  RETURN QUERY
  WITH cand AS (
    SELECT ec.episode_id, ec.chunk_idx,
      left(regexp_replace(btrim(COALESCE(NULLIF(split_part(ec.content, E'\nCONTENT:\n', 2), ''), ec.content)), '[[:space:]]+', ' ', 'g'), 420) AS content_snippet,
      ec.timestamp_start_seconds, ec.timestamp_end_seconds, ec.segment_start_idx, ec.segment_end_idx,
      ec.source_transcript_model, ec.chunking_method,
      (1 - (ec.embedding <=> query_embedding))::double precision AS sim
    FROM public.episode_chunks ec WHERE ec.content IS NOT NULL
    ORDER BY ec.embedding::halfvec(768) <=> query_embedding::halfvec(768)
    LIMIT GREATEST(1, LEAST(candidate_pool, 1000))
  ), ranked AS (SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.episode_id ORDER BY c.sim DESC) AS rn FROM cand c)
  SELECT r.episode_id, r.sim, 'chunk'::text, r.chunk_idx, r.content_snippet, r.timestamp_start_seconds, r.timestamp_end_seconds,
         r.segment_start_idx, r.segment_end_idx, r.source_transcript_model, r.chunking_method
  FROM ranked r WHERE r.rn = 1 ORDER BY r.sim DESC LIMIT GREATEST(1, LEAST(match_count, 100));
END;
$function$;
DELETE FROM public.search_query_cache WHERE q_norm IN ('paprikas krumpli','kvantumszamitogep','vitorlazas','zelenszkij','mi az oktatasban','kibeszelo','friderikusz','gulyasleves titka','orosz irodalom','fradi');