
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      (1::bigint,  '*/5 * * * *'),
      (2,  '* * * * *'),
      (3,  '0 * * * *'),
      (4,  '0 */2 * * *'),
      (5,  '*/15 * * * *'),
      (6,  '* * * * *'),
      (7,  '0 * * * *'),
      (8,  '0 */6 * * *'),
      (9,  '*/15 * * * *'),
      (10, '*/10 * * * *'),
      (11, '*/30 * * * *'),
      (13, '0 14 * * *'),
      (14, '0 */4 * * *'),
      (15, '*/30 * * * *'),
      (17, '0 */6 * * *'),
      (18, '*/15 * * * *'),
      (19, '15 */2 * * *'),
      (20, '*/30 * * * *'),
      (21, '*/5 * * * *'),
      (22, '*/10 * * * *'),
      (23, '*/30 * * * *'),
      (24, '0 */6 * * *'),
      (27, '17 */6 * * *'),
      (29, '*/30 * * * *'),
      (30, '*/5 * * * *'),
      (31, '* * * * *')
    ) AS t(jid, sched)
  LOOP
    PERFORM cron.alter_job(job_id := r.jid, schedule := r.sched);
    PERFORM cron.alter_job(job_id := r.jid, active := true);
  END LOOP;

  -- Person-judge burst no longer needed (0 pending); baseline (32) keeps running
  PERFORM cron.alter_job(job_id := 35, active := false);
END $$;
