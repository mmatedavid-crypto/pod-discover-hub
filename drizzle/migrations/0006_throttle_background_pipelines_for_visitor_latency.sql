-- Visitor-facing queries (topic / person episode lists) were exceeding the 3s
-- anon statement timeout because ~15 background drains run every 1-5 minutes on
-- a Small instance with a 34.5 GB database, saturating disk IO.
-- Throttle the non-user-facing drains to hourly-ish cadence. Reversible: the
-- adaptive schedule RPCs can bump them back up when a real backlog appears.
SELECT cron.alter_job(48, schedule => '*/20 * * * *');   -- organization-wikimedia-enricher
SELECT cron.alter_job(36, schedule => '*/20 * * * *');   -- episode-clean-text
SELECT cron.alter_job(54, schedule => '*/20 * * * *');   -- episode-topic-extractor
SELECT cron.alter_job(52, schedule => '*/20 * * * *');   -- person-relevance-judge
SELECT cron.alter_job(40, schedule => '*/20 * * * *');   -- entity-backfill
SELECT cron.alter_job(41, schedule => '*/20 * * * *');   -- organizations-backfill
SELECT cron.alter_job(61, schedule => '*/20 * * * *');   -- person-bio-generator
SELECT cron.alter_job(37, schedule => '*/20 * * * *');   -- person-wikimedia-enricher
SELECT cron.alter_job(31, schedule => '*/15 * * * *');   -- episode-classifier
SELECT cron.alter_job(30, schedule => '*/15 * * * *');   -- topic-judge
SELECT cron.alter_job(63, schedule => '*/15 * * * *');   -- database-quality-fast-lane
SELECT cron.alter_job(2,  schedule => '*/15 * * * *');   -- deep-hydrate
SELECT cron.alter_job(77, schedule => '*/30 * * * *');   -- mp3-duration-probe
SELECT cron.alter_job(82, schedule => '*/30 * * * *');   -- youtube-transcript-fetch
SELECT cron.alter_job(55, schedule => '*/30 * * * *');   -- embed-episode-chunks