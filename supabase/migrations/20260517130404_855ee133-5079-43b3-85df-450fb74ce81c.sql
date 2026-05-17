
-- Fix language-gate leaks revealed on homepage
-- 1) Stale is_hungarian=true rows whose AI-detected language is non-HU
UPDATE public.podcasts
SET is_hungarian = false,
    language_decision = 'reject_foreign',
    language_rejection_reason = 'post_gate_ai_lang_detected_non_hu',
    language_checked_at = now()
WHERE is_hungarian = true
  AND language IS NOT NULL
  AND language NOT ILIKE 'hu%';

-- 2) Refresh homepage materialized views
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_feed;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_evergreen;
