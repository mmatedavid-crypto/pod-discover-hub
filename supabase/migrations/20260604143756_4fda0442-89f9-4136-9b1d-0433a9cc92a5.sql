UPDATE episodes e
SET audio_probe_attempted_at = NULL
FROM podcasts p
WHERE e.podcast_id = p.id
  AND p.language ILIKE 'hu%'
  AND e.duration_seconds IS NULL
  AND e.audio_probe_attempted_at IS NOT NULL
  AND e.audio_url IS NOT NULL;