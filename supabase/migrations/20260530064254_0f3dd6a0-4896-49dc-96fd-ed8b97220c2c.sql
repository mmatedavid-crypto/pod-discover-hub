-- Add clean_text_autopilot to pipeline-watchdog registry.
-- Autopilot is an orchestrator: AI cost flows through child runners (ai_enrich, embed_episode_chunks),
-- so spend_key=null here. It self-disables on consecutive_errors, but watchdog adds stale_runner detection
-- and a budget-overshoot safety net if a daily_budget_usd is ever set on the autopilot key itself.
UPDATE public.app_settings
SET value = jsonb_set(
    value,
    '{runners}',
    (
      COALESCE(value->'runners', '[]'::jsonb)
      - (
        SELECT COALESCE(
          (SELECT idx - 1
             FROM jsonb_array_elements(value->'runners') WITH ORDINALITY AS t(elem, idx)
             WHERE elem->>'name' = 'clean_text_autopilot'
             LIMIT 1),
          -1
        )::int
      )
    ) || jsonb_build_array(jsonb_build_object(
      'name', 'clean_text_autopilot',
      'controls_key', 'clean_text_autopilot',
      'progress_key', 'clean_text_autopilot',
      'spend_key', null,
      'cadence_minutes', 10,
      'min_processed_for_error_rate', 5
    )),
    true
  ),
  updated_at = now()
WHERE key = 'watchdog_state';