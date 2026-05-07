
CREATE OR REPLACE FUNCTION public.set_incremental_refresh_schedule(_schedule text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
DECLARE v_jobid int;
BEGIN
  IF _schedule NOT IN ('*/5 * * * *','*/10 * * * *','*/30 * * * *','0 * * * *') THEN
    RAISE EXCEPTION 'invalid schedule: %', _schedule;
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='podiverzum-incremental-refresh-10min';
  IF v_jobid IS NULL THEN RAISE EXCEPTION 'incremental refresh cron not found'; END IF;
  PERFORM cron.alter_job(job_id := v_jobid, schedule := _schedule);
END $$;

CREATE OR REPLACE FUNCTION public.set_rss_hunter_schedule(_schedule text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
DECLARE v_jobid int;
BEGIN
  IF _schedule NOT IN ('*/30 * * * *','0 */2 * * *','0 */6 * * *','0 6 * * *') THEN
    RAISE EXCEPTION 'invalid schedule: %', _schedule;
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='podiverzum-rss-hunter-30min';
  IF v_jobid IS NULL THEN RAISE EXCEPTION 'rss hunter cron not found'; END IF;
  PERFORM cron.alter_job(job_id := v_jobid, schedule := _schedule);
END $$;

CREATE OR REPLACE FUNCTION public.set_title_cleanup_schedule(_schedule text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
DECLARE v_jobid int;
BEGIN
  IF _schedule NOT IN ('*/15 * * * *','0 * * * *','0 */6 * * *','0 6 * * *') THEN
    RAISE EXCEPTION 'invalid schedule: %', _schedule;
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='podiverzum-title-cleanup-6h';
  IF v_jobid IS NULL THEN RAISE EXCEPTION 'title cleanup cron not found'; END IF;
  PERFORM cron.alter_job(job_id := v_jobid, schedule := _schedule);
END $$;

CREATE OR REPLACE FUNCTION public.reap_ai_stale_locks(_older_than_minutes int DEFAULT 5)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v int;
BEGIN
  WITH u AS (
    UPDATE ai_enrichment_jobs
       SET status='pending', locked_until=NULL
     WHERE status='processing'
       AND locked_until IS NOT NULL
       AND locked_until < now() - make_interval(mins => _older_than_minutes)
     RETURNING 1
  ) SELECT count(*) INTO v FROM u;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.reap_deep_hydration_stale(_older_than_minutes int DEFAULT 30)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v int;
BEGIN
  WITH u AS (
    UPDATE podcasts
       SET deep_hydration_status='not_started',
           crawl_state = CASE WHEN crawl_state IN ('full_backfilled','incremental_refresh')
                              THEN crawl_state ELSE 'full_backfill_pending' END
     WHERE deep_hydration_status='in_progress'
       AND full_backfill_completed_at IS NULL
       AND (last_deep_hydrated_at IS NULL
            OR last_deep_hydrated_at < now() - make_interval(mins => _older_than_minutes))
     RETURNING 1
  ) SELECT count(*) INTO v FROM u;
  RETURN v;
END $$;
