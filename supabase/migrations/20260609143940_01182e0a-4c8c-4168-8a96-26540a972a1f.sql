INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'search_golden_refresh_controls',
  jsonb_build_object(
    'enabled', true, 'catalog_limit_per_type', 80, 'popular_limit', 40,
    'external_chart_limit', 120, 'external_seed_limit', 100, 'cadence', 'weekly',
    'note', 'Weekly refresh uses podcast titles, public people, organizations, topics, live search demand, Spotify/YouTube/chart signals and manual demand seeds.'
  ), now()
)
ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'search_benchmark_controls',
  jsonb_build_object(
    'enabled', true, 'cadence', 'weekly_drain', 'batch_size', 35,
    'max_queries_per_week', 220, 'per_call_timeout_ms', 45000, 'max_attempts', 2,
    'refresh_before_new_run', true, 'catalog_limit_per_type', 80, 'popular_limit', 40,
    'external_chart_limit', 120, 'external_seed_limit', 100, 'min_days_between_runs', 6,
    'quality_policy', 'weekly_search_benchmark_v1: fresh golden set first, then batched search-hybrid quality run with fetch failures excluded from quality metrics.',
    'note', 'The 30-minute cron is a drain runner: it noops when disabled or when the current weekly benchmark is complete.'
  ), now()
)
ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES
  ('search_golden_refresh_progress', jsonb_build_object('ok', null, 'status', 'not_run_yet'), now()),
  ('search_benchmark_progress', jsonb_build_object('ok', null, 'status', 'not_run_yet'), now())
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-search-golden-refresh-weekly') THEN
    PERFORM cron.unschedule('podiverzum-search-golden-refresh-weekly');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-search-benchmark-runner-30min') THEN
    PERFORM cron.unschedule('podiverzum-search-benchmark-runner-30min');
  END IF;
  PERFORM cron.schedule(
    'podiverzum-search-golden-refresh-weekly', '5 1 * * 1',
    $cmd$
    SELECT net.http_post(
      url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/search-golden-refresh',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
      body := concat('{"trigger":"weekly_cron","ts":"', now(), '"}')::jsonb);
    $cmd$);
  PERFORM cron.schedule(
    'podiverzum-search-benchmark-runner-30min', '*/30 * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/search-benchmark-runner',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
      body := concat('{"trigger":"benchmark_drain_cron","ts":"', now(), '"}')::jsonb);
    $cmd$);
END $$;

ALTER TABLE public.search_events
  ADD COLUMN IF NOT EXISTS timestamp_match_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chunk_augmented_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS semantic_used boolean,
  ADD COLUMN IF NOT EXISTS reranked boolean,
  ADD COLUMN IF NOT EXISTS podcast_pin_slug text,
  ADD COLUMN IF NOT EXISTS person_pin_slug text,
  ADD COLUMN IF NOT EXISTS organization_pin_slug text,
  ADD COLUMN IF NOT EXISTS topic_pin_slug text,
  ADD COLUMN IF NOT EXISTS catalog_anchors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS anchor_episode_candidates integer,
  ADD COLUMN IF NOT EXISTS natural_question jsonb,
  ADD COLUMN IF NOT EXISTS natural_question_fallback boolean,
  ADD COLUMN IF NOT EXISTS degraded_for_latency boolean,
  ADD COLUMN IF NOT EXISTS timing jsonb;

CREATE INDEX IF NOT EXISTS search_events_timestamp_matches_idx
  ON public.search_events (created_at DESC, timestamp_match_count, chunk_augmented_count);

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'search_engine',
  jsonb_build_object(
    'default_engine', 'v13', 'fallback_engine', 'v12', 'quality_guard_enabled', true,
    'chunk_aug_enabled', false,
    'chunk_aug_policy', 'operator_controlled_after_chunk_quality_verification_v1',
    'chunk_aug_prerequisites', jsonb_build_array(
      'episode_chunking_policy.timestamp_aware_v2',
      'episode_chunk_search_result_policy.timestamp_chunk_search_v3_content_snippet',
      'search_events.timestamp_match_count',
      'search_events.chunk_augmented_count'),
    'ranking_version', 6,
    'ranking_policy', 'v13_person_pin_natural_question_organization_topic_current_v6',
    'understanding_version', 4,
    'understanding_policy', 'anchor_first_catalog_resolution_current_v4',
    'reasserted_by', '20260608190000_reassert_search_engine_policy_v7_final',
    'note', 'Search v13 remains default with v12 fallback; chunk augmentation remains operator-controlled until production quality gates are trusted.'
  ), now()
)
ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at = now();