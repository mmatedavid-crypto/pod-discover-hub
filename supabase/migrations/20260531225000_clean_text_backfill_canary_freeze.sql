-- Freeze broad legacy v3 -> v4 backfill until cleaner quality is proven by
-- sampled audits. The latest sample showed improvement on some dirty rows, but
-- also overcut risk and remaining dirty text, so a global drain is unsafe.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_clean_text_controls',
  jsonb_build_object(
    'legacy_v3_backfill_enabled', false,
    'legacy_v3_backfill_mode', 'manual_canary_only',
    'legacy_v3_backfill_limit', 100,
    'quality_gate_required_before_global_backfill', true,
    'quality_gate_min_sample_size', 300,
    'quality_gate_max_overcut_rate', 0.01,
    'quality_gate_max_remaining_dirty_rate', 0.05,
    'quality_gate_min_improvement_rate_on_dirty_rows', 0.70,
    'last_quality_audit', jsonb_build_object(
      'sample_size', 300,
      'quality_ok', 190,
      'needs_ai_trim', 74,
      'possible_improvement', 110,
      'possible_overcut', 36,
      'remaining_dirty', 72,
      'decision', 'freeze_global_backfill'
    ),
    'note', 'Global v3->v4 backfill frozen: current cleaner is not proven safer/better. Use manual canary only until quality gates pass.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'legacy_v3_backfill_enabled', false,
    'legacy_v3_backfill_mode', 'manual_canary_only',
    'legacy_v3_backfill_limit', 100,
    'quality_gate_required_before_global_backfill', true,
    'quality_gate_min_sample_size', 300,
    'quality_gate_max_overcut_rate', 0.01,
    'quality_gate_max_remaining_dirty_rate', 0.05,
    'quality_gate_min_improvement_rate_on_dirty_rows', 0.70,
    'last_quality_audit', jsonb_build_object(
      'sample_size', 300,
      'quality_ok', 190,
      'needs_ai_trim', 74,
      'possible_improvement', 110,
      'possible_overcut', 36,
      'remaining_dirty', 72,
      'decision', 'freeze_global_backfill'
    ),
    'note', 'Global v3->v4 backfill frozen: current cleaner is not proven safer/better. Use manual canary only until quality gates pass.'
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'text_processing_policy',
  jsonb_build_object(
    'clean_text_backfill_status', 'frozen_pending_quality_proof',
    'clean_text_quality_audit_required', true,
    'note', 'Do not globally reprocess v3 clean text until sampled cleaner audit proves lower dirty rate without overcut risk.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'clean_text_backfill_status', 'frozen_pending_quality_proof',
    'clean_text_quality_audit_required', true,
    'note', 'Do not globally reprocess v3 clean text until sampled cleaner audit proves lower dirty rate without overcut risk.'
  ),
  updated_at = now();
