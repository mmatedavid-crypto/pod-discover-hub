
-- Re-enable database_quality_fast_lane (was auto-disabled after 5 503s during deploy moment)
UPDATE app_settings
SET value = value
  || jsonb_build_object('enabled', true, 'consecutive_errors', 0, 'last_errors', '[]'::jsonb)
WHERE key = 'database_quality_fast_lane';

-- Ramp clean_text_autopilot to full power (v4 backlog ~120k)
UPDATE app_settings
SET value = value || jsonb_build_object(
  'enabled', true,
  'dry_run', false,
  'stage_limit', 2000,
  'candidate_batch', 1000,
  'promote_limit', 1000,
  'ai_enrich_limit', 0,
  'daily_budget_usd', 0,
  'consecutive_errors', 0
)
WHERE key = 'clean_text_autopilot';

-- Bigger batch for the v3 base runner
UPDATE app_settings
SET value = value || jsonb_build_object('enabled', true, 'batch_limit', 1000, 'time_budget_seconds', 75)
WHERE key = 'episode_clean_text_controls';

-- Best text source: max throughput
UPDATE app_settings
SET value = value || jsonb_build_object('enabled', true, 'batch_limit', 10000)
WHERE key = 'episode_best_text_source_controls';
