
-- 1) Fix seo-enrich-enqueue cap: it reads `ai_seo_controls` which was missing → fell back to maxEps=300
INSERT INTO app_settings (key, value)
VALUES ('ai_seo_controls', jsonb_build_object(
  'max_podcasts_per_run', 200,
  'max_episodes_per_run', 5000
))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- 2) Re-tune cron cadence to match real backlog
-- BACKED-UP runners → max cadence
SELECT cron.alter_job(5,  schedule := '*/2 * * * *');   -- seo-enrich-enqueue: push 5k/run × 30/h = floods queue
SELECT cron.alter_job(6,  schedule := '* * * * *');     -- seo-enrich-runner: 43k missing summaries
SELECT cron.alter_job(15, schedule := '* * * * *');     -- pi-dump-process: 514 staging pending
SELECT cron.alter_job(2,  schedule := '* * * * *');     -- deep-hydrate: keep aggressive (650 pods)

-- IDLE / NEAR-DONE pipelines → step down
SELECT cron.alter_job(17, schedule := '0 */6 * * *');   -- ai-categorize: 0 uncategorized HU pods
SELECT cron.alter_job(11, schedule := '*/30 * * * *');  -- embed-episode: eligible≈embedded (≥99%)
SELECT cron.alter_job(9,  schedule := '*/15 * * * *');  -- embed-podcast: 688 done, near full
SELECT cron.alter_job(4,  schedule := '0 */2 * * *');   -- title-cleanup: 0 pending
SELECT cron.alter_job(14, schedule := '0 */4 * * *');   -- ai-feed-scout: was hitting Gemini 429, throttle
SELECT cron.alter_job(7,  schedule := '0 * * * *');     -- rss-self-healing: 0 errors recent

-- KEEP AS IS (already adaptive/right):
-- jobid 1 (queue-drainer */5), 3 (incremental-refresh */5 adaptive), 8 (rss-hunter 0 */6),
-- 10 (formula-c */10), 12 (homepage-feed-refresh */5), 13 (daily-social 14utc),
-- 16 (search-cache-cleanup weekly), 18 (entity-backfill */2 with 770 pending)
