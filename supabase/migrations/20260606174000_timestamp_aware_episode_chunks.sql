-- Add timestamp-aware episode chunks without changing the existing vector shape
-- or clean-text-first embedding gate.

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
 STABLE SECURITY DEFINER
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

INSERT INTO public.app_settings(key, value, updated_at)
VALUES (
  'episode_chunking_policy',
  jsonb_build_object(
    'version', 'timestamp_aware_v2',
    'preferred_source', 'episode_transcripts.segments when transcript content_hash matches episode_clean_text.source_hash',
    'fallback', 'char_window_v1',
    'target_words', jsonb_build_object('min', 150, 'max', 250, 'overlap', 50),
    'timestamp_fields', jsonb_build_array('timestamp_start_seconds', 'timestamp_end_seconds', 'segment_start_idx', 'segment_end_idx', 'source_transcript_model'),
    'clean_text_gate', 'deterministic_v4_family',
    'reasserted_by', '20260606174000_timestamp_aware_episode_chunks'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

DO $$
DECLARE
  v_chunks_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_chunks_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'select_embed_chunks_candidates'
    AND oidvectortypes(p.proargtypes) = 'text, integer'
  LIMIT 1;

  IF v_chunks_def IS NULL
     OR v_chunks_def NOT ILIKE '%transcript_segments jsonb%'
     OR v_chunks_def NOT ILIKE '%bt.content_hash = ct.source_hash%'
     OR v_chunks_def NOT ILIKE '%ct.cleaner_method LIKE ''deterministic_v4%%''%' THEN
    RAISE EXCEPTION 'timestamp-aware chunk candidate RPC must keep clean-text gate and matched transcript segments';
  END IF;
END $$;
