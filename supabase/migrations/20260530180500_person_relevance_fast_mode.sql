INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'person_relevance_judge_controls',
  jsonb_build_object(
    'enabled', true,
    'daily_budget_usd', 25.0,
    'batch_limit', 160,
    'concurrency', 12,
    'max_ai_calls_per_run', 800,
    'min_confidence_for_ai', 0.50,
    'prefer_paid', true,
    'auto_disable_when_empty', true,
    'note', 'Fast mode 2026-05-30: do not throttle quality progress. Keep waste guards, but use high throughput and a circuit-breaker budget only.'
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
    || jsonb_build_object('person_relevance', 25, 'person_relevance_judge', 25),
  true
) || jsonb_build_object(
  'updated_at', now()::text,
  'updated_note', '2026-05-30: person relevance fast mode. Spend cap is now a runaway circuit breaker, not a throughput throttle.'
),
updated_at = now()
WHERE key = 'ai_budget';
