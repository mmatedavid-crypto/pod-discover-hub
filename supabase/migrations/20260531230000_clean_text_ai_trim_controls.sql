-- Prepare the hybrid clean-text path without enabling any paid AI work.
-- AI trim may only run after a reviewed gold eval proves the deterministic
-- quality gate and prompt are safe enough.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_clean_text_ai_trim_controls',
  jsonb_build_object(
    'enabled', false,
    'mode', 'disabled_until_gold_eval_passes',
    'candidate_policy', 'assessCleanTextQuality.needs_ai_trim_only',
    'overcut_policy', 'do_not_ai_trim_overcut_risk_without_review',
    'model', 'google/gemini-2.5-flash-lite',
    'daily_budget_usd', 0,
    'batch_limit', 0,
    'concurrency', 0,
    'max_input_chars', 6000,
    'min_original_overlap', 0.90,
    'must_be_extract_only', true,
    'gold_eval_required', true,
    'gold_eval_min_rows', 60,
    'gold_eval_max_candidate_dirty_rate', 0.05,
    'gold_eval_max_candidate_overcut_rate', 0.01,
    'gold_eval_min_candidate_token_f1', 0.80,
    'note', 'Paid AI trim is intentionally disabled. Enable only after scripts/evaluate-clean-text-gold.mjs passes on reviewed gold sample.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'enabled', false,
    'mode', 'disabled_until_gold_eval_passes',
    'candidate_policy', 'assessCleanTextQuality.needs_ai_trim_only',
    'overcut_policy', 'do_not_ai_trim_overcut_risk_without_review',
    'model', 'google/gemini-2.5-flash-lite',
    'daily_budget_usd', 0,
    'batch_limit', 0,
    'concurrency', 0,
    'max_input_chars', 6000,
    'min_original_overlap', 0.90,
    'must_be_extract_only', true,
    'gold_eval_required', true,
    'gold_eval_min_rows', 60,
    'gold_eval_max_candidate_dirty_rate', 0.05,
    'gold_eval_max_candidate_overcut_rate', 0.01,
    'gold_eval_min_candidate_token_f1', 0.80,
    'note', 'Paid AI trim is intentionally disabled. Enable only after scripts/evaluate-clean-text-gold.mjs passes on reviewed gold sample.'
  ),
  updated_at = now();
