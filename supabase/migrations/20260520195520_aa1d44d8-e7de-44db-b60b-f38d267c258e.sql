
-- Accelerate clean-text drain: bump batch + time budget, sustain deterministic_v1 (no AI).
UPDATE app_settings
SET value = jsonb_set(
  jsonb_set(
    jsonb_set(value, '{batch_limit}', '500'::jsonb),
    '{time_budget_seconds}', '60'::jsonb
  ),
  '{note}', '"2026-05-20: deterministic-only, no AI; gates chunk embed. Drain-loop + bulk upsert + */2 cron for 50% gate push."'::jsonb
)
WHERE key = 'episode_clean_text_controls';

-- Tighten cron from */10 to */2 (5x more invocations; each invocation now drain-loops in-memory).
SELECT cron.alter_job(job_id := 36, schedule := '*/2 * * * *');
