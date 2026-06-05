-- Search quality should improve from measurement, not gut feel.
-- Refresh the golden set weekly from catalog + demand signals, then drain one
-- weekly benchmark run in safe batches so edge-function timeouts do not turn
-- into false zero-result metrics.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'search_golden_refresh_controls',
  jsonb_build_object(
    'enabled', true,
    'catalog_limit_per_type', 80,
    'popular_limit', 40,
    'external_chart_limit', 120,
    'external_seed_limit', 100,
    'cadence', 'weekly',
    'note', 'Weekly refresh uses podcast titles, public people, organizations, topics, live search demand, Spotify/YouTube/chart signals and manual demand seeds.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'search_benchmark_controls',
  jsonb_build_object(
    'enabled', true,
    'cadence', 'weekly_drain',
    'batch_size', 35,
    'max_queries_per_week', 220,
    'per_call_timeout_ms', 45000,
    'max_attempts', 2,
    'refresh_before_new_run', true,
    'catalog_limit_per_type', 80,
    'popular_limit', 40,
    'external_chart_limit', 120,
    'external_seed_limit', 100,
    'min_days_between_runs', 6,
    'quality_policy', 'weekly_search_benchmark_v1: fresh golden set first, then batched search-hybrid quality run with fetch failures excluded from quality metrics.',
    'note', 'The 30-minute cron is a drain runner: it noops when disabled or when the current weekly benchmark is complete.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

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
    'podiverzum-search-golden-refresh-weekly',
    '5 1 * * 1',
    $cmd$
    SELECT net.http_post(
      url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/search-golden-refresh',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
      body := concat('{"trigger":"weekly_cron","ts":"', now(), '"}')::jsonb
    );
    $cmd$
  );

  PERFORM cron.schedule(
    'podiverzum-search-benchmark-runner-30min',
    '*/30 * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/search-benchmark-runner',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
      body := concat('{"trigger":"benchmark_drain_cron","ts":"', now(), '"}')::jsonb
    );
    $cmd$
  );
END $$;
