UPDATE app_settings
SET value = value
  || jsonb_build_object(
    'concurrency', 100,
    'batch_limit', 500,
    'daily_budget_usd', 100,
    'note', 'Tier2 Gemini direct drain boost 2026-05-19: concurrency 100, batch 500, $100/day, single cron.'
  )
WHERE key = 'person_relevance_judge_controls';