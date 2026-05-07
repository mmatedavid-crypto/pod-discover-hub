
CREATE OR REPLACE FUNCTION public.get_ops_dashboard_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $$
DECLARE
  v jsonb;
  v_summary jsonb;
  v_dh jsonb;
  v_ai jsonb;
  v_emb jsonb;
  v_ref jsonb;
  v_hunt jsonb;
  v_stage jsonb;
  v_title jsonb;
  v_cron jsonb;
  v_growth jsonb;
  v_settings jsonb;
BEGIN
  -- Summary
  SELECT jsonb_build_object(
    'total_podcasts', (SELECT count(*) FROM podcasts),
    'total_episodes', (SELECT count(*) FROM episodes),
    'tier_dist', (
      SELECT COALESCE(jsonb_object_agg(tier, c), '{}'::jsonb)
      FROM (SELECT COALESCE(rank_label,'unranked') AS tier, count(*) c FROM podcasts GROUP BY rank_label) t
    ),
    'shadow_tier_dist', (
      SELECT COALESCE(jsonb_object_agg(tier, c), '{}'::jsonb)
      FROM (SELECT COALESCE(shadow_rank_tier,'unranked') AS tier, count(*) c FROM podcasts GROUP BY shadow_rank_tier) t
    ),
    'rss_status_dist', (
      SELECT COALESCE(jsonb_object_agg(rss_status, c), '{}'::jsonb)
      FROM (SELECT rss_status, count(*) c FROM podcasts GROUP BY rss_status) t
    ),
    'failed_feeds', (SELECT count(*) FROM podcasts WHERE consecutive_failure_count > 0),
    'quarantined', (SELECT count(*) FROM podcasts WHERE quarantined_until IS NOT NULL AND quarantined_until > now()),
    'manual_review', (SELECT count(*) FROM podcasts WHERE rss_status='needs_manual_rss_review'),
    'ai_pending', (SELECT count(*) FROM ai_enrichment_jobs WHERE status='pending'),
    'spend_today', COALESCE((SELECT spend_usd FROM ai_spend_daily WHERE day=current_date), 0),
    'dh_pending', (SELECT count(*) FROM podcasts WHERE full_backfill_completed_at IS NULL AND shadow_rank_tier IN ('S','A','B','C')),
    'embed_pending', (SELECT count(*) FROM podcasts p WHERE shadow_rank_tier IN ('S','A','B','C') AND NOT EXISTS (SELECT 1 FROM podcast_embeddings e WHERE e.podcast_id=p.id)),
    'staging_unprocessed', (SELECT count(*) FROM pi_feed_staging WHERE NOT processed),
    'discovery_pending', (SELECT count(*) FROM discovery_queue WHERE status='pending')
  ) INTO v_summary;

  -- Deep hydration
  SELECT jsonb_build_object(
    'pending_S', (SELECT count(*) FROM podcasts WHERE shadow_rank_tier='S' AND full_backfill_completed_at IS NULL),
    'pending_A', (SELECT count(*) FROM podcasts WHERE shadow_rank_tier='A' AND full_backfill_completed_at IS NULL),
    'pending_B', (SELECT count(*) FROM podcasts WHERE shadow_rank_tier='B' AND full_backfill_completed_at IS NULL),
    'pending_C', (SELECT count(*) FROM podcasts WHERE shadow_rank_tier='C' AND full_backfill_completed_at IS NULL),
    'in_progress', (SELECT count(*) FROM podcasts WHERE deep_hydration_status='in_progress'),
    'stale_in_progress', (SELECT count(*) FROM podcasts WHERE deep_hydration_status='in_progress' AND (last_deep_hydrated_at IS NULL OR last_deep_hydrated_at < now() - interval '30 minutes')),
    'failed', (SELECT count(*) FROM podcasts WHERE deep_hydration_status='failed'),
    'episodes_15m', (SELECT count(*) FROM episodes WHERE created_at > now() - interval '15 minutes'),
    'episodes_1h', (SELECT count(*) FROM episodes WHERE created_at > now() - interval '1 hour'),
    'episodes_24h', (SELECT count(*) FROM episodes WHERE created_at > now() - interval '24 hours'),
    'last_run', (SELECT value->'last_run' FROM app_settings WHERE key='deep_hydration')
  ) INTO v_dh;

  -- AI enrichment
  SELECT jsonb_build_object(
    'pending_S', (SELECT count(*) FROM ai_enrichment_jobs WHERE status='pending' AND priority>=100),
    'pending_A', (SELECT count(*) FROM ai_enrichment_jobs WHERE status='pending' AND priority>=80 AND priority<100),
    'pending_B', (SELECT count(*) FROM ai_enrichment_jobs WHERE status='pending' AND priority>=60 AND priority<80),
    'pending_C', (SELECT count(*) FROM ai_enrichment_jobs WHERE status='pending' AND priority>=40 AND priority<60),
    'pending_other', (SELECT count(*) FROM ai_enrichment_jobs WHERE status='pending' AND priority<40),
    'processing', (SELECT count(*) FROM ai_enrichment_jobs WHERE status='processing'),
    'stale_locks', (SELECT count(*) FROM ai_enrichment_jobs WHERE status='processing' AND locked_until < now() - interval '5 minutes'),
    'failed_total', (SELECT count(*) FROM ai_enrichment_jobs WHERE status='failed'),
    'failed_1h', (SELECT count(*) FROM ai_enrichment_jobs WHERE status='failed' AND completed_at > now() - interval '1 hour'),
    'done_15m', (SELECT count(*) FROM ai_enrichment_jobs WHERE status='done' AND completed_at > now() - interval '15 minutes'),
    'done_1h', (SELECT count(*) FROM ai_enrichment_jobs WHERE status='done' AND completed_at > now() - interval '1 hour'),
    'done_24h', (SELECT count(*) FROM ai_enrichment_jobs WHERE status='done' AND completed_at > now() - interval '24 hours'),
    'spend_today', COALESCE((SELECT spend_usd FROM ai_spend_daily WHERE day=current_date), 0),
    'controls', (SELECT value FROM app_settings WHERE key='ai_seo_controls')
  ) INTO v_ai;

  -- Embeddings
  SELECT jsonb_build_object(
    'embedded_total', (SELECT count(*) FROM podcast_embeddings),
    'pending_tiered', (SELECT count(*) FROM podcasts p WHERE shadow_rank_tier IN ('S','A','B','C') AND NOT EXISTS (SELECT 1 FROM podcast_embeddings e WHERE e.podcast_id=p.id)),
    'progress', (SELECT value FROM app_settings WHERE key='embed_progress'),
    'controls', (SELECT value FROM app_settings WHERE key='embed_controls')
  ) INTO v_emb;

  -- Incremental refresh
  SELECT jsonb_build_object(
    'due_count', (SELECT count(*) FROM podcasts WHERE crawl_state IN ('full_backfilled','incremental_refresh') AND (next_fetch_at IS NULL OR next_fetch_at <= now()) AND (quarantined_until IS NULL OR quarantined_until < now()) AND (last_fetched_at IS NULL OR last_fetched_at + (refresh_interval_minutes||' minutes')::interval < now())),
    'failed_feeds', (SELECT count(*) FROM podcasts WHERE consecutive_failure_count > 0),
    'under_backoff', (SELECT count(*) FROM podcasts WHERE next_fetch_at IS NOT NULL AND next_fetch_at > now()),
    'fetched_15m', (SELECT count(*) FROM podcasts WHERE last_fetched_at > now() - interval '15 minutes'),
    'fetched_1h', (SELECT count(*) FROM podcasts WHERE last_fetched_at > now() - interval '1 hour'),
    'last_run', (SELECT value->'last_run' FROM app_settings WHERE key='incremental_refresh')
  ) INTO v_ref;

  -- RSS hunter
  SELECT jsonb_build_object(
    'due_count', (SELECT count(*) FROM podcasts WHERE next_rss_hunt_at IS NOT NULL AND next_rss_hunt_at <= now()),
    'manual_review', (SELECT count(*) FROM podcasts WHERE rss_status='needs_manual_rss_review'),
    'not_found', (SELECT count(*) FROM podcasts WHERE rss_status='rss_url_not_found'),
    'recovered_recent', (SELECT count(*) FROM podcasts WHERE rss_status='recovered_rss_url' AND last_rss_hunt_at > now() - interval '24 hours'),
    'last_run', (SELECT value->'last_run' FROM app_settings WHERE key='rss_hunter')
  ) INTO v_hunt;

  -- Staging / discovery / growth
  SELECT jsonb_build_object(
    'staging_unprocessed', (SELECT count(*) FROM pi_feed_staging WHERE NOT processed),
    'staging_backoff', (SELECT count(*) FROM pi_feed_staging WHERE next_process_attempt_at IS NOT NULL AND next_process_attempt_at > now()),
    'staging_decisions', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(decision,'undecided'), c), '{}'::jsonb)
      FROM (SELECT decision, count(*) c FROM pi_feed_staging GROUP BY decision) t
    ),
    'discovery_pending', (SELECT count(*) FROM discovery_queue WHERE status='pending'),
    'discovery_backoff', (SELECT count(*) FROM discovery_queue WHERE next_import_attempt_at IS NOT NULL AND next_import_attempt_at > now()),
    'growth_autopilot', (SELECT value FROM app_settings WHERE key='growth_autopilot'),
    'growth_runs_24h', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'trigger',trigger,'ok',ok,'started_at',started_at,'finished_at',finished_at,'error',error)), '[]'::jsonb)
      FROM (SELECT * FROM growth_runs WHERE started_at > now() - interval '24 hours' ORDER BY started_at DESC LIMIT 20) t
    ),
    'growth_timed_out_24h', (SELECT count(*) FROM growth_runs WHERE started_at > now() - interval '24 hours' AND (stats->>'status' IN ('timed_out','timed_out_prevented') OR (finished_at IS NULL AND started_at < now() - interval '5 minutes')))
  ) INTO v_stage;

  -- Title cleanup
  SELECT jsonb_build_object(
    'pending_podcasts', (SELECT count(*) FROM podcasts WHERE display_title IS NULL),
    'pending_episodes', (SELECT count(*) FROM episodes WHERE display_title IS NULL),
    'last_run', (SELECT value->'last_run' FROM app_settings WHERE key='title_cleanup')
  ) INTO v_title;

  -- Cron
  SELECT COALESCE(jsonb_agg(jsonb_build_object('jobid',jobid,'jobname',jobname,'schedule',schedule,'active',active) ORDER BY jobid), '[]'::jsonb)
  INTO v_cron FROM cron.job;

  v := jsonb_build_object(
    'generated_at', now(),
    'summary', v_summary,
    'deep_hydration', v_dh,
    'ai_enrichment', v_ai,
    'embeddings', v_emb,
    'incremental_refresh', v_ref,
    'rss_hunter', v_hunt,
    'staging_discovery', v_stage,
    'title_cleanup', v_title,
    'cron', v_cron
  );
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.get_ops_dashboard_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ops_dashboard_status() TO authenticated, service_role;
