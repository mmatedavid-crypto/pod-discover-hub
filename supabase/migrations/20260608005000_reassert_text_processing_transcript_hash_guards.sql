-- Keep transcript-aware clean-text/hash guards after downstream embedding policy reassertions.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'text_processing_policy',
  jsonb_build_object(
    'version', 'best_source_clean_text_first_v3_transcript_aware',
    'embedding_requires_clean_text', true,
    'accepted_cleaner_method_prefix', 'deterministic_v4',
    'language_gate', 'podcasts.language_decision=accept_hungarian',
    'transcript_source_hash_passthrough', true,
    'timestamp_chunking_requires_transcript_hash_match', true,
    'reasserted_by', '20260608005000_reassert_text_processing_transcript_hash_guards'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = public.app_settings.value || EXCLUDED.value,
  updated_at = now();
