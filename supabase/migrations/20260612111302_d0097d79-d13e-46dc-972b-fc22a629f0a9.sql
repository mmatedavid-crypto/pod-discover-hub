
-- Duplicate
SELECT cron.unschedule(86);

-- Pause idle jobs: alter_job(job_id, schedule, command, database, username, active)
SELECT cron.alter_job(46, NULL, NULL, NULL, NULL, false);
SELECT cron.alter_job(42, NULL, NULL, NULL, NULL, false);
SELECT cron.alter_job(75, NULL, NULL, NULL, NULL, false);
SELECT cron.alter_job(89, NULL, NULL, NULL, NULL, false);

-- Throttle overscheduled jobs
SELECT cron.alter_job(2,  '*/5 * * * *');
SELECT cron.alter_job(31, '*/5 * * * *');
SELECT cron.alter_job(73, '*/30 * * * *');
SELECT cron.alter_job(79, '*/30 * * * *');
SELECT cron.alter_job(72, '0 4 * * *');
SELECT cron.alter_job(19, '0 */4 * * *');
SELECT cron.alter_job(78, '*/30 * * * *');
SELECT cron.alter_job(65, '0 3 * * *');
