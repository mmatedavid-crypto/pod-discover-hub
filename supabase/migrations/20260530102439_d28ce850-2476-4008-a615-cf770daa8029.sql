INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'data_repair_controls',
  jsonb_build_object(
    'enabled', true,
    'dry_run', true,
    'batch_limit', 100,
    'allowed_apply_actions', jsonb_build_array('neutralize_legacy_episode_rank'),
    'note', 'No-AI apply runner. Starts dry-run; only legacy episode rank neutralization is supported.'
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
    WHERE r->>'name' <> 'data_repair_apply_runner'
  )
  || jsonb_build_array(
    jsonb_build_object(
      'name', 'data_repair_apply_runner',
      'controls_key', 'data_repair_controls',
      'progress_key', 'data_repair_controls',
      'spend_key', null,
      'cadence_minutes', 0,
      'min_processed_for_error_rate', 1
    )
  ),
  true
),
updated_at = now()
WHERE key = 'watchdog_state';

UPDATE public.app_settings
SET value = value
  || jsonb_build_object(
    'mode', 'repair_queue',
    'note', 'Clean-text refresh now uses v_data_repair_queue priority when available. Full pipeline remains dry-run unless explicitly disabled.'
  ),
  updated_at = now()
WHERE key = 'clean_text_autopilot';

DO $$
DECLARE
  table_name text;
  audit_tables text[] := ARRAY[
    'ai_call_audit',
    'ai_enrichment_jobs',
    'ai_runs',
    'ai_spend_daily',
    'app_settings',
    'discovery_queue',
    'episode_clean_text',
    'episode_clean_text_candidates',
    'episode_transcripts',
    'growth_runs',
    'org_ai_review_jobs',
    'person_ai_review_jobs',
    'person_enrichment_jobs',
    'pi_dump_imports',
    'pi_feed_staging',
    'podcast_language_cleanup_log',
    'queue_health_events',
    'search_benchmark_results',
    'search_benchmark_runs',
    'search_events',
    'social_posts'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    GRANT USAGE ON SCHEMA public TO readonly_codex;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_codex;
  END IF;

  FOREACH table_name IN ARRAY audit_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "codex readonly audit select" ON public.%I', table_name);
      EXECUTE format(
        'CREATE POLICY "codex readonly audit select" ON public.%I FOR SELECT USING (current_user = %L)',
        table_name,
        'readonly_codex'
      );
    END IF;
  END LOOP;
END $$;