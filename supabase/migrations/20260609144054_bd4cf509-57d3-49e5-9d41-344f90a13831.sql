UPDATE public.app_settings
SET value = jsonb_set(
  value,
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
    FROM jsonb_array_elements(COALESCE(value->'runners', '[]'::jsonb)) r
    WHERE r->>'name' <> 'spotify_transcript_runner'
  ),
  true
),
updated_at = now()
WHERE key = 'watchdog_state';