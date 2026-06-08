-- Keep the legacy clean-text backfill freeze visible after later text_processing_policy reassertions.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'text_processing_policy',
  jsonb_build_object(
    'clean_text_backfill_status', 'frozen_pending_quality_proof',
    'legacy_v3_backfill', 'manual_canary_only_until_quality_proof',
    'reasserted_by', '20260608006000_reassert_clean_text_backfill_freeze_status'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = public.app_settings.value || EXCLUDED.value,
  updated_at = now();
