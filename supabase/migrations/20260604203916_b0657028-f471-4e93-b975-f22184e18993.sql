
-- YT channel-scout bump (cron 19) and episode-pairer rescan_after_days loosening
-- to unblock the YouTube full-catalog coverage drain.

-- 1) Channel-scout: faster cadence + larger batch + bumped daily quota
UPDATE app_settings
SET value = jsonb_set(
  jsonb_set(
    jsonb_set(value, '{channel_batch}', '50'::jsonb),
    '{daily_api_quota_units}', '9500'::jsonb
  ),
  '{bumped_at}', to_jsonb(now()::text)
)
WHERE key = 'youtube_scout_controls';

SELECT cron.alter_job(19, schedule := '*/30 * * * *');

-- 2) Episode-pairer: tighter rescan window so deep-history catchup actually runs
UPDATE app_settings
SET value = jsonb_set(
  jsonb_set(value, '{rescan_after_days}', '3'::jsonb),
  '{rescan_loosened_at}', to_jsonb(now()::text)
)
WHERE key = 'youtube_episode_pairer_controls';
