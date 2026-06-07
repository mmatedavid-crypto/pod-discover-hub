-- Promote full episode transcripts into the best-text-source chain.
-- This lets deterministic clean text carry the transcript content_hash forward,
-- so timestamp-aware chunking can attach transcript segments to search hits.

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT c.conname
    INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'episode_best_text_source'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%source_type%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.episode_best_text_source DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.episode_best_text_source
  ADD CONSTRAINT episode_best_text_source_source_type_check
  CHECK (source_type IN ('rss', 'spotify', 'youtube', 'article', 'transcript'));

ALTER TABLE public.episode_best_text_source
  VALIDATE CONSTRAINT episode_best_text_source_source_type_check;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_best_text_source_controls',
  jsonb_build_object(
    'enabled', true,
    'batch_limit', 1000,
    'youtube_min_confidence', 0.78,
    'spotify_min_confidence', 0.55,
    'article_min_confidence', 0.82,
    'transcript_min_chars', 900,
    'prefer_external_gain_chars', 150,
    'article_prefer_gain_chars', 300,
    'rescan_after_days', 7,
    'policy', 'best_text_source_v3_transcript_first_confirmed_article_youtube'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = public.app_settings.value
    || jsonb_build_object(
      'enabled', true,
      'transcript_min_chars', 900,
      'policy', 'best_text_source_v3_transcript_first_confirmed_article_youtube'
    ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'text_processing_policy',
  jsonb_build_object(
    'version', 'best_source_clean_text_first_v3_transcript_aware',
    'order', jsonb_build_array(
      'episode_transcripts',
      'episode_best_text_source',
      'episode_clean_text.deterministic_v4_family',
      'episode_chunks.timestamp_aware_embeddings'
    ),
    'embedding_requires_clean_text', true,
    'accepted_cleaner_method_prefix', 'deterministic_v4',
    'transcript_source_hash_passthrough', true,
    'timestamp_chunking_requires_transcript_hash_match', true
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = public.app_settings.value
    || jsonb_build_object(
      'version', 'best_source_clean_text_first_v3_transcript_aware',
      'transcript_source_hash_passthrough', true,
      'timestamp_chunking_requires_transcript_hash_match', true
    ),
  updated_at = now();
