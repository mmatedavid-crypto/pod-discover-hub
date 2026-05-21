-- Unschedule cron jobs
SELECT cron.unschedule(11);
SELECT cron.unschedule(21);

-- Disable controls
UPDATE app_settings
SET value = COALESCE(value, '{}'::jsonb) || jsonb_build_object('enabled', false, 'disabled_at', now()::text, 'disabled_reason', 'manual_stop_2026_05_21')
WHERE key IN ('embed_episode_controls','youtube_transcript_controls');