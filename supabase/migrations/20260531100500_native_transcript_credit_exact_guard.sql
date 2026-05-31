INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'youtube_transcript_controls',
  jsonb_build_object(
    'enabled', true,
    'batch', 20,
    'max_supadata_calls_per_run', 20,
    'concurrency', 2,
    'delay_ms', 1800,
    'daily_credit_limit', 750,
    'daily_budget_usd', 2,
    'preferred_lang', 'hu',
    'transcript_mode', 'native',
    'native_only', true,
    'require_youtube_caption_available', true,
    'require_description_gain', false,
    'min_match_score', 0.84,
    'match_policy', 'youtube_episode_match_v3',
    'note', 'Exact Supadata native transcript guard: one credit may be spent only for one v3-confirmed video where YouTube metadata already reported native captions; ASR/generated transcripts are not stored.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'enabled', true,
    'batch', 20,
    'max_supadata_calls_per_run', 20,
    'concurrency', 2,
    'delay_ms', 1800,
    'daily_credit_limit', 750,
    'daily_budget_usd', 2,
    'transcript_mode', 'native',
    'native_only', true,
    'require_youtube_caption_available', true,
    'require_description_gain', false,
    'match_policy', 'youtube_episode_match_v3',
    'note', 'Exact Supadata native transcript guard: one credit may be spent only for one v3-confirmed video where YouTube metadata already reported native captions; ASR/generated transcripts are not stored.'
  ),
  updated_at = now();
