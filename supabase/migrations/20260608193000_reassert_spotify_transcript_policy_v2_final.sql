-- Final Spotify native transcript policy reassertion.
-- The runner stays operator-controlled and disabled by default; this only
-- preserves app_settings state/controls/watchdog/cron policy after later rewrites.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'spotify_transcript_controls',
  jsonb_build_object(
    'enabled', false,
    'batch_size', 10,
    'delay_ms', 1000,
    'daily_cap', 100,
    'time_budget_ms', 70000,
    'candidate_scan_limit', 2500,
    'policy', 'default_disabled_operator_controlled_native_transcript_indexing_v1',
    'model', 'spotify-native',
    'cron_job', 'podiverzum-spotify-transcript-runner',
    'cron_schedule', '*/5 * * * *',
    'rights_status', 'spotify_private_api_index_only',
    'public_display', false,
    'reasserted_by', '20260608193000_reassert_spotify_transcript_policy_v2_final',
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
      'candidate_scan_limit', COALESCE(public.app_settings.value->'candidate_scan_limit', '2500'::jsonb),
      'policy', 'default_disabled_operator_controlled_native_transcript_indexing_v1',
      'model', 'spotify-native',
      'cron_job', 'podiverzum-spotify-transcript-runner',
      'cron_schedule', '*/5 * * * *',
      'rights_status', 'spotify_private_api_index_only',
      'public_display', false,
      'reasserted_by', '20260608193000_reassert_spotify_transcript_policy_v2_final'
    ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'spotify_transcript_state',
  jsonb_build_object(
    'skip', jsonb_build_object(),
    'daily', jsonb_build_object(),
    'policy', 'short_window_duplicate_skip_and_daily_cap_v1',
    'reasserted_by', '20260608193000_reassert_spotify_transcript_policy_v2_final'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = public.app_settings.value
    || jsonb_build_object(
      'skip', COALESCE(public.app_settings.value->'skip', '{}'::jsonb),
      'daily', COALESCE(public.app_settings.value->'daily', '{}'::jsonb),
      'policy', 'short_window_duplicate_skip_and_daily_cap_v1',
      'reasserted_by', '20260608193000_reassert_spotify_transcript_policy_v2_final'
    ),
  updated_at = now();

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
DECLARE
  v_controls jsonb;
  v_state jsonb;
  v_runner jsonb;
BEGIN
  SELECT value INTO v_controls
  FROM public.app_settings
  WHERE key = 'spotify_transcript_controls';

  SELECT value INTO v_state
  FROM public.app_settings
  WHERE key = 'spotify_transcript_state';

  SELECT r INTO v_runner
  FROM public.app_settings s,
       jsonb_array_elements(COALESCE(s.value->'runners', '[]'::jsonb)) r
  WHERE s.key = 'watchdog_state'
    AND r->>'name' = 'spotify_transcript_runner'
  LIMIT 1;

  IF COALESCE((v_controls->>'enabled')::boolean, true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'spotify_transcript_controls.enabled must default to false';
  END IF;

  IF COALESCE(v_controls->>'policy', '') <> 'default_disabled_operator_controlled_native_transcript_indexing_v1'
     OR COALESCE(v_controls->>'cron_job', '') <> 'podiverzum-spotify-transcript-runner'
     OR COALESCE(v_controls->>'cron_schedule', '') <> '*/5 * * * *'
     OR COALESCE(v_controls->>'rights_status', '') <> 'spotify_private_api_index_only'
     OR COALESCE((v_controls->>'public_display')::boolean, true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'spotify_transcript_controls policy/cron/private-display contract is incomplete';
  END IF;

  IF NOT (v_state ? 'skip') OR NOT (v_state ? 'daily') THEN
    RAISE EXCEPTION 'spotify_transcript_state must retain skip and daily duplicate/cap maps';
  END IF;

  IF v_runner IS NULL
     OR COALESCE(v_runner->>'controls_key', '') <> 'spotify_transcript_controls'
     OR COALESCE(v_runner->>'progress_key', '') <> 'spotify_transcript_progress' THEN
    RAISE EXCEPTION 'pipeline watchdog must register spotify_transcript_runner controls/progress keys';
  END IF;
END $$;
