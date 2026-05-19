UPDATE app_settings
SET value = value
  || jsonb_build_object(
       'daily_budget_usd', 50,
       'batch_limit', 120,
       'concurrency', 8,
       'note', 'Drain boost 2026-05-19: $50/day, batch 120, concurrency 8. Other 26 crons paused. Revert to $10/120/1 after drain.'
     ),
    updated_at = now()
WHERE key = 'person_relevance_judge_controls';