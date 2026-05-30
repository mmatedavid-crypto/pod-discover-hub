-- Adaptive YouTube metadata drain: run fast while backlog exists, then fall
-- back to maintenance scans. Keep the fast lane focused on low-risk metadata
-- steps so unrelated AI/entity workers cannot self-disable it during the drain.

ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS youtube_episode_pair_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS youtube_episode_pair_claim_owner text;

CREATE INDEX IF NOT EXISTS podcasts_youtube_pair_claim_idx
  ON public.podcasts (youtube_episode_pair_claimed_at)
  WHERE youtube_channel_id IS NOT NULL
    AND youtube_pairing_status = 'paired';

CREATE OR REPLACE FUNCTION public.claim_youtube_episode_pair_podcasts(
  p_limit integer DEFAULT 10,
  p_tiers text[] DEFAULT ARRAY['S','A','B','C','D','E'],
  p_cutoff timestamptz DEFAULT now() - interval '7 days',
  p_claim_timeout_minutes integer DEFAULT 45
)
RETURNS TABLE (
  id uuid,
  title text,
  youtube_channel_id text,
  shadow_rank_tier text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner text := 'yt-pairer-' || txid_current()::text;
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT p.id
    FROM public.podcasts p
    WHERE p.youtube_pairing_status = 'paired'
      AND p.youtube_channel_id IS NOT NULL
      AND p.is_hungarian = true
      AND p.shadow_rank_tier = ANY(p_tiers)
      AND (p.youtube_last_episode_pair_at IS NULL OR p.youtube_last_episode_pair_at < p_cutoff)
      AND (
        p.youtube_episode_pair_claimed_at IS NULL
        OR p.youtube_episode_pair_claimed_at < now() - make_interval(mins => p_claim_timeout_minutes)
      )
    ORDER BY p.youtube_last_episode_pair_at ASC NULLS FIRST
    LIMIT GREATEST(1, LEAST(50, p_limit))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.podcasts p
  SET youtube_episode_pair_claimed_at = now(),
      youtube_episode_pair_claim_owner = v_owner
  FROM picked
  WHERE p.id = picked.id
  RETURNING p.id, p.title::text, p.youtube_channel_id::text, p.shadow_rank_tier::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_youtube_episode_pair_podcasts(integer, text[], timestamptz, integer) TO service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'youtube_episode_pairer_controls',
  jsonb_build_object(
    'enabled', true,
    'adaptive_enabled', true,
    'mode', 'adaptive_drain_then_maintenance',
    'tiers', jsonb_build_array('S','A','B','C','D','E'),
    'policy', 'youtube_episode_match_v3',
    'rescan_after_days', 7,
    'drain_until_due_below', 50,
    'catchup_until_due_below', 10,
    'drain_podcast_batch', 20,
    'catchup_podcast_batch', 10,
    'maintenance_podcast_batch', 3,
    'drain_max_videos_per_channel', 220,
    'catchup_max_videos_per_channel', 160,
    'maintenance_max_videos_per_channel', 80,
    'drain_episode_limit', 1000,
    'catchup_episode_limit', 800,
    'maintenance_episode_limit', 350,
    'time_budget_ms', 165000,
    'max_ai_calls_per_run', 80,
    'claim_timeout_minutes', 45,
    'strict_auto_pair_threshold', 0.84,
    'strict_ai_pair_threshold', 0.78,
    'min_ambiguity_gap', 0.04,
    'ai_validate_model', 'google/gemini-2.5-flash-lite',
    'note', '2026-05-30: adaptive YouTube metadata drain; max stable speed now, maintenance after backlog.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'enabled', true,
    'adaptive_enabled', true,
    'mode', 'adaptive_drain_then_maintenance',
    'tiers', jsonb_build_array('S','A','B','C','D','E'),
    'policy', 'youtube_episode_match_v3',
    'rescan_after_days', 7,
    'drain_until_due_below', 50,
    'catchup_until_due_below', 10,
    'drain_podcast_batch', 20,
    'catchup_podcast_batch', 10,
    'maintenance_podcast_batch', 3,
    'drain_max_videos_per_channel', 220,
    'catchup_max_videos_per_channel', 160,
    'maintenance_max_videos_per_channel', 80,
    'drain_episode_limit', 1000,
    'catchup_episode_limit', 800,
    'maintenance_episode_limit', 350,
    'time_budget_ms', 165000,
    'max_ai_calls_per_run', 80,
    'claim_timeout_minutes', 45,
    'strict_auto_pair_threshold', 0.84,
    'strict_ai_pair_threshold', 0.78,
    'min_ambiguity_gap', 0.04,
    'ai_validate_model', 'google/gemini-2.5-flash-lite',
    'note', '2026-05-30: adaptive YouTube metadata drain; max stable speed now, maintenance after backlog.'
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'database_quality_fast_lane',
  jsonb_build_object(
    'enabled', true,
    'consecutive_errors', 0,
    'run_data_repair', false,
    'run_entity_quality', false,
    'run_youtube_pairer', false,
    'run_best_text_source', true,
    'best_text_source_limit', 5000,
    'run_clean_text', false,
    'run_entity_backfill', false,
    'run_person_entity_extractor', false,
    'run_organizations_backfill', false,
    'run_topic_extractor', false,
    'max_runtime_ms', 120000,
    'auto_stop_at_errors', 10,
    'note', '2026-05-30: focused best-text fast lane; YouTube pairer runs every minute with parallel-safe claims.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'enabled', true,
    'consecutive_errors', 0,
    'run_data_repair', false,
    'run_entity_quality', false,
    'run_youtube_pairer', false,
    'run_best_text_source', true,
    'best_text_source_limit', 5000,
    'run_clean_text', false,
    'run_entity_backfill', false,
    'run_person_entity_extractor', false,
    'run_organizations_backfill', false,
    'run_topic_extractor', false,
    'max_runtime_ms', 120000,
    'auto_stop_at_errors', 10,
    'note', '2026-05-30: focused best-text fast lane; YouTube pairer runs every minute with parallel-safe claims.'
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'youtube_episode_pairer_progress',
  jsonb_build_object(
    'ok', true,
    'pending_first_adaptive_run', true,
    'last_configured_at', now(),
    'expected_cadence_minutes', 1
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'pending_first_adaptive_run', true,
    'last_configured_at', now(),
    'expected_cadence_minutes', 1
  ),
  updated_at = now();

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'podiverzum-database-quality-fast-lane-5min'
  LIMIT 1;

  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(
      'podiverzum-database-quality-fast-lane-5min',
      '*/2 * * * *',
      $cmd$
      SELECT net.http_post(
        url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/database-quality-fast-lane',
        headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
        body := concat('{"trigger":"cron","ts":"', now(), '"}')::jsonb
      );
      $cmd$
    );
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '*/2 * * * *', active := true);
  END IF;

  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'podiverzum-youtube-episode-pairer-1min'
  LIMIT 1;

  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(
      'podiverzum-youtube-episode-pairer-1min',
      '* * * * *',
      $cmd$
      SELECT net.http_post(
        url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/youtube-episode-pairer',
        headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
        body := concat('{"trigger":"cron","ts":"', now(), '"}')::jsonb
      );
      $cmd$
    );
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '* * * * *', active := true);
  END IF;
END $$;
