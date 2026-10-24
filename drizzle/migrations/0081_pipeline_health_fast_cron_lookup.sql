-- Health snapshot: the last cron run is found by the job id on the cron.job_run_details primary
-- key (runid DESC) instead of sorting the whole run history by start_time, which made the
-- admin snapshot exceed the request timeout.
CREATE OR REPLACE FUNCTION public.pipeline_runner_health_item_v1(p_name text, p_runner text, p_cron_pattern text,
  p_backlog bigint, p_backlog_label text, p_expected_every interval, p_paused_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'cron' AS $$
DECLARE
  v_last_ok timestamptz; v_last record; v_ok int; v_err int; v_killed int; v_running int;
  v_cron jsonb; v_jobid bigint; v_disp timestamptz; v_disp_status text;
  v_health text := 'green'; v_rec text := 'OK';
BEGIN
  SELECT max(finished_at) INTO v_last_ok FROM public.pipeline_runner_runs WHERE runner = p_runner AND outcome = 'ok';
  SELECT started_at, finished_at, outcome, stage, error, meta INTO v_last FROM public.pipeline_runner_runs
   WHERE runner = p_runner ORDER BY started_at DESC LIMIT 1;
  SELECT count(*) FILTER (WHERE outcome = 'ok'), count(*) FILTER (WHERE outcome = 'error'),
         count(*) FILTER (WHERE outcome = 'killed' OR (outcome = 'running' AND heartbeat_at < now() - interval '10 minutes')),
         count(*) FILTER (WHERE outcome = 'running' AND heartbeat_at >= now() - interval '10 minutes')
    INTO v_ok, v_err, v_killed, v_running
    FROM public.pipeline_runner_runs WHERE runner = p_runner AND started_at > now() - interval '24 hours';
  SELECT j.jobid, jsonb_build_object('jobid', j.jobid, 'jobname', j.jobname, 'schedule', j.schedule, 'active', j.active)
    INTO v_jobid, v_cron FROM cron.job j WHERE j.jobname ILIKE p_cron_pattern ORDER BY j.active DESC, j.jobid LIMIT 1;
  IF v_jobid IS NOT NULL THEN
    SELECT r.start_time, r.status INTO v_disp, v_disp_status FROM cron.job_run_details r
     WHERE r.jobid = v_jobid AND r.status <> 'connecting' ORDER BY r.runid DESC LIMIT 1;
  END IF;
  IF p_paused_reason IS NOT NULL THEN
    v_health := 'paused'; v_rec := p_paused_reason;
  ELSIF v_cron IS NULL OR coalesce((v_cron->>'active')::boolean, false) IS FALSE THEN
    v_health := 'yellow'; v_rec := 'No active cron job; runner is not scheduled.';
  ELSIF v_last_ok IS NULL THEN
    v_health := 'yellow'; v_rec := 'No recorded completion yet (run log introduced 2026-10-24).';
  ELSIF v_last_ok < now() - (p_expected_every * 3) THEN
    v_health := 'red'; v_rec := 'Cron dispatches but the function has not completed recently; check function logs.';
  ELSIF v_killed > 0 OR v_err > 0 THEN
    v_health := 'yellow'; v_rec := 'Recent runs killed or failed; completions continue.';
  END IF;
  RETURN jsonb_build_object('name', p_name, 'health', v_health, 'recommendation', v_rec, 'runner', p_runner,
    'cron', v_cron, 'last_dispatch_at', v_disp, 'last_dispatch_status', v_disp_status,
    'last_completion_at', v_last_ok,
    'last_run', CASE WHEN v_last.started_at IS NULL THEN NULL ELSE jsonb_build_object('started_at', v_last.started_at, 'finished_at', v_last.finished_at,
      'outcome', v_last.outcome, 'stage', v_last.stage, 'error', v_last.error, 'meta', v_last.meta) END,
    'runs_24h', jsonb_build_object('ok', v_ok, 'error', v_err, 'killed', v_killed, 'running', v_running),
    'backlog', p_backlog, 'backlog_label', p_backlog_label);
END $$;
REVOKE ALL ON FUNCTION public.pipeline_runner_health_item_v1(text, text, text, bigint, text, interval, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pipeline_runner_health_item_v1(text, text, text, bigint, text, interval, text) TO service_role;

CREATE OR REPLACE FUNCTION public.pipeline_health_item_v1(p_name text, p_controls_key text, p_progress_key text, p_cron_pattern text, p_backlog bigint DEFAULT NULL::bigint, p_backlog_label text DEFAULT 'eligible backlog'::text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'cron' AS $function$
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
  v_jobid bigint := NULL;
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

  SELECT j.jobid, jsonb_build_object('jobid', j.jobid, 'jobname', j.jobname, 'schedule', j.schedule, 'active', j.active)
  INTO v_jobid, cron_job FROM cron.job j
  WHERE p_cron_pattern IS NOT NULL AND j.jobname ILIKE p_cron_pattern
  ORDER BY j.active DESC, j.jobid LIMIT 1;

  IF v_jobid IS NOT NULL THEN
    SELECT jsonb_build_object('status', r.status, 'start_time', r.start_time, 'end_time', r.end_time,
      'duration_ms', EXTRACT(EPOCH FROM (r.end_time - r.start_time)) * 1000, 'return_message', r.return_message)
    INTO last_run FROM cron.job_run_details r
    WHERE r.jobid = v_jobid AND r.status <> 'connecting'
    ORDER BY r.runid DESC LIMIT 1;
  END IF;

  last_progress_at := prog_updated;
  last_cron_at := NULLIF(last_run->>'start_time', '')::timestamptz;
  last_cron_status := last_run->>'status';

  IF enabled IS FALSE THEN
    health := 'red'; recommendation := 'Runner disabled; only acceptable if intentionally paused.';
  ELSIF last_error IS NOT NULL AND length(trim(last_error)) > 0 THEN
    health := 'red'; recommendation := 'Last error is set; inspect function logs and controls.';
  ELSIF last_cron_status IS NOT NULL AND last_cron_status NOT IN ('succeeded', 'running') THEN
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
$function$;