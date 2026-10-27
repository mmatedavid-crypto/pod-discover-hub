-- Hourly org maintenance in one job: refresh podcast publishers, demote self-only orgs (publishers exempt),
-- then recompute visibility so publisher pages and merged duplicates take effect.
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'demote-publisher-self-orgs'),
  command := 'SELECT public.refresh_podcast_publishers_v1(); SELECT public.demote_publisher_self_orgs(); SELECT public.recompute_org_gated_counts();'
);