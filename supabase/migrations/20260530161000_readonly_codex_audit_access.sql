-- Allow the dedicated direct-SQL audit role to inspect operational tables.
-- This does not affect anon/authenticated API access because Supabase API
-- requests run as authenticator/authenticated/anon, not as readonly_codex.

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
