INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'person_relevance_judge_controls',
  jsonb_build_object(
    'enabled', true,
    'daily_budget_usd', 3.0,
    'batch_limit', 40,
    'concurrency', 3,
    'max_ai_calls_per_run', 120,
    'min_confidence_for_ai', 0.55,
    'prefer_paid', false,
    'auto_disable_when_empty', true,
    'note', 'Cost guard 2026-05-30: use evidence/rule guard first, cap AI calls per run, and align daily budget with ai_budget spend key.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

UPDATE public.app_settings
SET value = jsonb_set(
  value,
  '{per_job_caps_usd}',
  COALESCE(value->'per_job_caps_usd', '{}'::jsonb)
    || jsonb_build_object('person_relevance', 3, 'person_relevance_judge', 3),
  true
) || jsonb_build_object(
  'updated_at', now()::text,
  'updated_note', '2026-05-30: align person relevance spend key with runner and cap at $3/day.'
),
updated_at = now()
WHERE key = 'ai_budget';
