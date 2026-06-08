-- Keep the best-text-source chain transcript-first even when an older
-- app_settings row already exists with partial publisher-article controls.

ALTER TABLE public.episode_best_text_source
  DROP CONSTRAINT IF EXISTS episode_best_text_source_source_type_check;

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
    'policy', 'best_text_source_v3_transcript_first_confirmed_article_youtube',
    'reasserted_by', '20260608010000_reassert_best_text_source_transcript_first_policy'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = public.app_settings.value
    || jsonb_build_object(
      'enabled', true,
      'batch_limit', 1000,
      'youtube_min_confidence', 0.78,
      'spotify_min_confidence', 0.55,
      'article_min_confidence', 0.82,
      'transcript_min_chars', 900,
      'prefer_external_gain_chars', 150,
      'article_prefer_gain_chars', 300,
      'rescan_after_days', 7,
      'policy', 'best_text_source_v3_transcript_first_confirmed_article_youtube',
      'reasserted_by', '20260608010000_reassert_best_text_source_transcript_first_policy'
    ),
  updated_at = now();
