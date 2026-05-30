INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'database_quality_fast_lane',
  jsonb_build_object(
    'enabled', true,
    'no_ai_dry_run', false,
    'run_data_repair', true,
    'data_repair_limit', 500,
    'run_entity_quality', true,
    'entity_quality_limit', 500,
    'run_clean_text', true,
    'run_entity_backfill', true,
    'entity_backfill_batch', 400,
    'entity_backfill_concurrency', 24,
    'run_person_entity_extractor', true,
    'person_entity_limit', 10000,
    'run_organizations_backfill', true,
    'organizations_backfill_batch', 1000,
    'run_topic_extractor', true,
    'topic_batch', 40,
    'max_runtime_ms', 145000,
    'auto_stop_at_errors', 5,
    'consecutive_errors', 0,
    'note', 'Same-day database quality fast lane. No-AI repairs run live; AI workers remain capped by their own model, hash, quality, and daily budget gates.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'data_repair_controls',
  jsonb_build_object(
    'enabled', true,
    'dry_run', false,
    'batch_limit', 500,
    'note', 'Fast-lane enabled for no-AI, non-destructive repairs only.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'entity_quality_controls',
  jsonb_build_object(
    'enabled', true,
    'dry_run', false,
    'snapshot_limit', 500,
    'apply_limit', 500,
    'batch_limit', 500,
    'allowed_apply_actions', jsonb_build_array('hide_low_confidence_organization'),
    'auto_stop_at_errors', 5,
    'consecutive_errors', 0,
    'note', 'Fast-lane enabled for no-AI entity quality repairs. Hides low-confidence false entities from public/index surfaces; does not delete mentions.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'clean_text_autopilot',
  jsonb_build_object(
    'enabled', true,
    'dry_run', false,
    'mode', 'bad_or_old',
    'tiers', jsonb_build_array('S', 'A', 'B', 'C'),
    'stage_limit', 1000,
    'candidate_batch', 500,
    'promote_limit', 500,
    'ai_enrich_limit', 50,
    'daily_budget_usd', 5.0,
    'auto_stop_at_errors', 5,
    'consecutive_errors', 0,
    'note', 'Fast-lane clean text refresh. Promotes only changed candidates that pass quality gates; AI enrich is capped and hash-deduped.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'entity_backfill_controls',
  jsonb_build_object(
    'enabled', true,
    'model', 'google/gemini-2.5-flash-lite',
    'daily_budget_usd', 5.0,
    'entity_schema_version', 5,
    'strict_evidence_required', true,
    'note', 'Fast-lane entity extraction v5. Requires literal evidence for people/orgs; skips empty/short input; budget guarded by entity_backfill spend key.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_topic_extractor_controls',
  jsonb_build_object(
    'enabled', true,
    'model', 'google/gemini-2.5-flash-lite',
    'batch_limit', 40,
    'concurrency', 8,
    'tier_filter', jsonb_build_array('S', 'A'),
    'min_clean_chars', 400,
    'daily_budget_usd', 3.0,
    'max_runtime_ms', 120000,
    'extractor_version', 1,
    'note', 'Fast-lane topic extraction for high-value Hungarian episodes, budget-capped and blocked from expensive pro/GPT-5-class models.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

UPDATE public.app_settings
SET value = jsonb_set(
  value,
  '{runners}',
  (
    SELECT COALESCE(jsonb_agg(r), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(value->'runners', '[]'::jsonb)) r
    WHERE r->>'name' NOT IN ('database_quality_fast_lane')
  )
  || jsonb_build_array(
    jsonb_build_object(
      'name', 'database_quality_fast_lane',
      'controls_key', 'database_quality_fast_lane',
      'progress_key', 'database_quality_fast_lane',
      'spend_key', null,
      'cadence_minutes', 5,
      'min_processed_for_error_rate', 1
    )
  ),
  true
),
updated_at = now()
WHERE key = 'watchdog_state';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-database-quality-fast-lane-5min'
  ) THEN
    PERFORM cron.schedule(
      'podiverzum-database-quality-fast-lane-5min',
      '*/5 * * * *',
      $cmd$
      SELECT net.http_post(
        url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/database-quality-fast-lane',
        headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
        body := concat('{"trigger":"cron","ts":"', now(), '"}')::jsonb
      );
      $cmd$
    );
  END IF;
END $$;
