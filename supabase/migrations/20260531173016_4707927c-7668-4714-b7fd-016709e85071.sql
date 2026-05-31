-- Unified pipeline health snapshot for admin/ops.
CREATE OR REPLACE FUNCTION public.pipeline_health_item_v1(
  p_name text,
  p_controls_key text,
  p_progress_key text,
  p_cron_pattern text,
  p_backlog bigint DEFAULT NULL,
  p_backlog_label text DEFAULT 'eligible backlog'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $$
DECLARE
  ctrl jsonb := '{}'::jsonb;
  prog jsonb := '{}'::jsonb;
  ctrl_updated timestamptz;
  prog_updated timestamptz;
  enabled boolean := true;
  spend_today numeric := NULL;
  daily_budget numeric := NULL;
  last_error text := NULL;
  note text := NULL;
  cron_job jsonb := NULL;
  last_run jsonb := NULL;
  last_progress_at timestamptz := NULL;
  last_cron_at timestamptz := NULL;
  last_cron_status text := NULL;
  health text := 'green';
  recommendation text := 'OK';
BEGIN
  SELECT value, updated_at INTO ctrl, ctrl_updated FROM public.app_settings WHERE key = p_controls_key LIMIT 1;
  SELECT value, updated_at INTO prog, prog_updated FROM public.app_settings WHERE key = p_progress_key LIMIT 1;
  ctrl := COALESCE(ctrl, '{}'::jsonb);
  prog := COALESCE(prog, '{}'::jsonb);
  enabled := COALESCE(
    CASE WHEN ctrl ? 'enabled' THEN (ctrl->>'enabled')::boolean ELSE NULL END,
    CASE WHEN ctrl ? 'cron_enabled' THEN (ctrl->>'cron_enabled')::boolean ELSE NULL END,
    CASE WHEN ctrl ? 'disabled' THEN NOT ((ctrl->>'disabled')::boolean) ELSE NULL END,
    true
  );
  spend_today := NULLIF(ctrl->>'spend_today_usd', '')::numeric;
  daily_budget := NULLIF(ctrl->>'daily_budget_usd', '')::numeric;
  last_error := COALESCE(ctrl->>'last_error', prog->>'last_error', prog->>'error');
  note := COALESCE(ctrl->>'note', prog->>'note');

  SELECT jsonb_build_object('jobid', j.jobid, 'jobname', j.jobname, 'schedule', j.schedule, 'active', j.active)
  INTO cron_job FROM cron.job j
  WHERE p_cron_pattern IS NOT NULL AND j.jobname ILIKE p_cron_pattern
  ORDER BY j.active DESC, j.jobid LIMIT 1;

  SELECT jsonb_build_object('status', r.status, 'start_time', r.start_time, 'end_time', r.end_time,
    'duration_ms', EXTRACT(EPOCH FROM (r.end_time - r.start_time)) * 1000, 'return_message', r.return_message)
  INTO last_run FROM cron.job_run_details r JOIN cron.job j ON j.jobid = r.jobid
  WHERE p_cron_pattern IS NOT NULL AND j.jobname ILIKE p_cron_pattern
  ORDER BY r.start_time DESC LIMIT 1;

  last_progress_at := prog_updated;
  last_cron_at := NULLIF(last_run->>'start_time', '')::timestamptz;
  last_cron_status := last_run->>'status';

  IF enabled IS FALSE THEN
    health := 'red'; recommendation := 'Runner disabled; only acceptable if intentionally paused.';
  ELSIF last_error IS NOT NULL AND length(trim(last_error)) > 0 THEN
    health := 'red'; recommendation := 'Last error is set; inspect function logs and controls.';
  ELSIF last_cron_status IS NOT NULL AND last_cron_status <> 'succeeded' THEN
    health := 'red'; recommendation := 'Last cron run failed; inspect cron.job_run_details return_message.';
  ELSIF p_backlog IS NOT NULL AND p_backlog > 0 AND last_progress_at IS NULL THEN
    health := 'yellow'; recommendation := 'Backlog exists but no progress row is present.';
  ELSIF p_backlog IS NOT NULL AND p_backlog > 0 AND last_progress_at < now() - interval '3 hours' THEN
    health := 'yellow'; recommendation := 'Backlog exists and progress is stale.';
  ELSIF cron_job IS NOT NULL AND COALESCE((cron_job->>'active')::boolean, false) IS FALSE AND enabled IS TRUE THEN
    health := 'yellow'; recommendation := 'Controls enabled but cron job is inactive.';
  ELSIF p_backlog IS NOT NULL AND p_backlog = 0 THEN
    health := 'green'; recommendation := 'No backlog.';
  END IF;

  RETURN jsonb_build_object(
    'name', p_name, 'health', health, 'recommendation', recommendation, 'enabled', enabled,
    'controls_key', p_controls_key, 'progress_key', p_progress_key,
    'controls_updated_at', ctrl_updated, 'progress_updated_at', prog_updated,
    'cron', cron_job, 'last_cron_run', last_run,
    'backlog', p_backlog, 'backlog_label', p_backlog_label,
    'spend_today_usd', spend_today, 'daily_budget_usd', daily_budget,
    'last_error', last_error, 'note', note
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pipeline_health_snapshot_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $$
DECLARE
  v_clean_pending bigint; v_best_missing bigint; v_youtube_due bigint; v_native_transcript bigint;
  v_chunk_missing bigint; v_person_pending bigint; v_org_public_unreviewed bigint;
  v_search_goldens bigint; v_weekly_posts bigint; v_items jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT count(*) INTO v_clean_pending
  FROM public.episodes e JOIN public.podcasts p ON p.id = e.podcast_id
  WHERE p.is_hungarian = true AND p.language_decision = 'accept_hungarian'
    AND COALESCE(e.description, '') <> ''
    AND NOT EXISTS (SELECT 1 FROM public.episode_clean_text ct WHERE ct.episode_id = e.id AND ct.cleaner_method = 'deterministic_v4');

  SELECT count(*) INTO v_best_missing
  FROM public.episodes e JOIN public.podcasts p ON p.id = e.podcast_id
  WHERE p.is_hungarian = true AND p.language_decision = 'accept_hungarian'
    AND COALESCE(e.description, '') <> ''
    AND NOT EXISTS (SELECT 1 FROM public.episode_best_text_source b WHERE b.episode_id = e.id);

  SELECT count(*) INTO v_youtube_due
  FROM public.podcasts p
  WHERE p.is_hungarian = true AND p.language_decision = 'accept_hungarian'
    AND COALESCE(p.rss_status, 'active') <> 'dead'
    AND (p.youtube_url IS NOT NULL OR EXISTS (
      SELECT 1 FROM public.podcast_youtube_candidates pyc
      WHERE pyc.podcast_id = p.id AND pyc.status IN ('confirmed', 'accepted')))
    AND (p.youtube_last_episode_pair_at IS NULL OR p.youtube_last_episode_pair_at < now() - interval '7 days');

  SELECT count(*) INTO v_native_transcript
  FROM public.episode_youtube_links yl
  WHERE yl.status = 'confirmed' AND yl.youtube_caption_available = true
    AND NOT EXISTS (SELECT 1 FROM public.episode_transcripts tr
      WHERE tr.episode_id = yl.episode_id AND tr.model IN ('supadata-youtube', 'supadata-youtube-native'));

  SELECT count(DISTINCT e.id) INTO v_chunk_missing
  FROM public.episodes e JOIN public.podcasts p ON p.id = e.podcast_id
  JOIN public.episode_clean_text ct ON ct.episode_id = e.id
  WHERE p.is_hungarian = true AND p.language_decision = 'accept_hungarian'
    AND ct.cleaner_method = 'deterministic_v4'
    AND NOT EXISTS (SELECT 1 FROM public.episode_chunks ch WHERE ch.episode_id = e.id);

  SELECT count(*) INTO v_person_pending FROM public.person_episode_mentions WHERE relevance_status IN ('pending', 'in_progress');
  SELECT count(*) INTO v_org_public_unreviewed FROM public.organizations WHERE is_public = true AND COALESCE(ai_review_status, 'pending') IN ('pending', 'needs_review');
  SELECT count(*) INTO v_search_goldens FROM public.search_golden_queries WHERE COALESCE(active, true) = true;
  SELECT count(*) INTO v_weekly_posts FROM public.editorial_posts WHERE published_at > now() - interval '14 days';

  v_items := jsonb_build_array(
    public.pipeline_health_item_v1('clean_text_v4', 'clean_text_autopilot', 'episode_clean_text_candidate_progress', '%clean-text%', v_clean_pending, 'HU episodes without deterministic_v4 clean text'),
    public.pipeline_health_item_v1('best_text_source', 'episode_best_text_source_controls', 'episode_best_text_source_progress', '%best-text-source%', v_best_missing, 'HU episodes without selected best text source'),
    public.pipeline_health_item_v1('youtube_episode_pairer', 'youtube_episode_pairer_controls', 'youtube_episode_pairer_progress', '%youtube%pair%', v_youtube_due, 'HU podcasts due for YouTube episode pairing'),
    public.pipeline_health_item_v1('native_transcript_fetch', 'youtube_transcript_controls', 'youtube_transcript_progress', '%transcript%', v_native_transcript, 'confirmed YouTube episodes with native captions not fetched'),
    public.pipeline_health_item_v1('episode_chunk_embeddings', 'embed_episode_chunks_controls', 'embed_episode_chunks_progress', '%embed%episode%chunk%', v_chunk_missing, 'clean HU episodes without episode chunks'),
    public.pipeline_health_item_v1('person_relevance_judge', 'person_relevance_judge_controls', 'person_relevance_judge_progress', '%person%relevance%', v_person_pending, 'person mentions pending relevance judgment'),
    public.pipeline_health_item_v1('entity_quality_autopilot', 'entity_quality_controls', 'entity_quality_autopilot_progress', '%entity%quality%', v_org_public_unreviewed, 'public organizations pending AI/entity review'),
    public.pipeline_health_item_v1('search_quality_benchmark', 'search_benchmark_controls', 'search_benchmark_progress', '%search%benchmark%', v_search_goldens, 'active golden queries'),
    public.pipeline_health_item_v1('weekly_editorial', 'weekly_editorial_controls', 'weekly_editorial_progress', '%weekly%editorial%', CASE WHEN v_weekly_posts > 0 THEN 0 ELSE 1 END, 'weekly editorial posts missing in the last 14 days')
  );

  RETURN jsonb_build_object(
    'generated_at', now(),
    'version', 'pipeline_health_snapshot_v1',
    'summary', jsonb_build_object(
      'green', (SELECT count(*) FROM jsonb_array_elements(v_items) x WHERE x->>'health' = 'green'),
      'yellow', (SELECT count(*) FROM jsonb_array_elements(v_items) x WHERE x->>'health' = 'yellow'),
      'red', (SELECT count(*) FROM jsonb_array_elements(v_items) x WHERE x->>'health' = 'red')
    ),
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pipeline_health_item_v1(text, text, text, text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pipeline_health_item_v1(text, text, text, text, bigint, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_pipeline_health_snapshot_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipeline_health_snapshot_v1() TO authenticated, service_role;