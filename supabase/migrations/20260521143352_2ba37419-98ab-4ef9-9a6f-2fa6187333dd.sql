UPDATE app_settings
SET value = jsonb_set(
  value,
  '{runners}',
  (SELECT jsonb_agg(r) FROM jsonb_array_elements(value->'runners') r
    WHERE r->>'name' NOT IN ('embed_episode','youtube_transcript'))
)
WHERE key='watchdog_state';