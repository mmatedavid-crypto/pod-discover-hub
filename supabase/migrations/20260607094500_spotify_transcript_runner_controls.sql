-- Spotify native transcript runner controls.
-- The cron is installed as a no-op drain: the runner exits immediately while
-- spotify_transcript_controls.enabled=false.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'spotify_transcript_controls',
  jsonb_build_object(
    'enabled', false,
    'batch_size', 10,
    'delay_ms', 1000,
    'daily_cap', 100,
    'time_budget_ms', 70000,
    'policy', 'default_disabled_operator_controlled_native_transcript_indexing_v1',
    'model', 'spotify-native',
    'cron_job', 'podiverzum-spotify-transcript-runner',
    'cron_schedule', '*/5 * * * *',
    'rights_status', 'spotify_private_api_index_only',
    'public_display', false,
    'note', 'Manual enable only. Stores transcript text for indexing/chunking; public display remains disabled.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = public.app_settings.value
    || jsonb_build_object(
      'enabled', COALESCE(public.app_settings.value->'enabled', 'false'::jsonb),
      'batch_size', COALESCE(public.app_settings.value->'batch_size', '10'::jsonb),
      'delay_ms', COALESCE(public.app_settings.value->'delay_ms', '1000'::jsonb),
      'daily_cap', COALESCE(public.app_settings.value->'daily_cap', '100'::jsonb),
      'time_budget_ms', COALESCE(public.app_settings.value->'time_budget_ms', '70000'::jsonb),
      'policy', 'default_disabled_operator_controlled_native_transcript_indexing_v1',
      'model', 'spotify-native',
      'cron_job', 'podiverzum-spotify-transcript-runner',
      'cron_schedule', '*/5 * * * *',
      'rights_status', 'spotify_private_api_index_only',
      'public_display', false
    ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'spotify_transcript_state',
  jsonb_build_object(
    'skip', jsonb_build_object(),
    'daily', jsonb_build_object(),
    'policy', 'short_window_duplicate_skip_and_daily_cap_v1'
  ),
  now()
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'watchdog_state',
  jsonb_build_object(
    'enabled', true,
    'dry_run', true,
    'runners', jsonb_build_array(jsonb_build_object(
      'name', 'spotify_transcript_runner',
      'controls_key', 'spotify_transcript_controls',
      'progress_key', 'spotify_transcript_progress',
      'spend_key', null,
      'cadence_minutes', 5,
      'min_processed_for_error_rate', 10
    ))
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = jsonb_set(
    public.app_settings.value,
    '{runners}',
    (
      SELECT COALESCE(jsonb_agg(r), '[]'::jsonb)
             || jsonb_build_array(jsonb_build_object(
               'name', 'spotify_transcript_runner',
               'controls_key', 'spotify_transcript_controls',
               'progress_key', 'spotify_transcript_progress',
               'spend_key', null,
               'cadence_minutes', 5,
               'min_processed_for_error_rate', 10
             ))
      FROM jsonb_array_elements(COALESCE(public.app_settings.value->'runners', '[]'::jsonb)) r
      WHERE r->>'name' <> 'spotify_transcript_runner'
    ),
    true
  ),
  updated_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-spotify-transcript-runner') THEN
    PERFORM cron.unschedule('podiverzum-spotify-transcript-runner');
  END IF;

  PERFORM cron.schedule(
    'podiverzum-spotify-transcript-runner',
    '*/5 * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/spotify-transcript-runner',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
      body := concat('{"trigger":"cron","ts":"', now(), '"}')::jsonb
    );
    $cmd$
  );
END $$;
