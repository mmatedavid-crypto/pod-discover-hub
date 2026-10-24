-- Owner 2026-10-24 17:00: raise the repaired catch-up's actual throughput.
-- 1) Dispatch selection is driven from the small set of dispatchable derivation rows (partial
--    index) instead of walking all episodes newest-first (17 200 episode rows read to find 120;
--    worse as the backlog moves to older episodes). Eligibility, actions and ceilings unchanged.
-- 2) No overlap: a concurrent dispatch fails fast with dispatch_busy (55P03) instead of queueing
--    behind the running one (every-minute cron).
-- 3) extend_pipeline_catchup_v1: service-only, audited extension of the ACTIVE catch-up (same
--    old/new bookkeeping, so expiry/conditional restore still keeps later owner edits), plus
--    temporary runner cadences / dispatch tuning honoured only while the derivation part is active.

CREATE INDEX IF NOT EXISTS eds_dispatchable_idx ON public.episode_derivation_state (episode_id)
  WHERE clean_usable AND dispatch_attempts < 3
    AND (entity_status IN ('stale', 'queued') OR topic_status IN ('stale', 'queued') OR seo_status IN ('stale', 'queued'));

CREATE OR REPLACE FUNCTION public.dispatch_stale_derivations_v1(p_limit integer DEFAULT 20, p_dry_run boolean DEFAULT false)
 RETURNS TABLE(episode_id uuid, podcast_id uuid, seo_dispatch boolean, topic_action text, entity_action text, clean_hash text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  ctrl jsonb; st jsonb; tctrl jsonb;
  v_today text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  v_used integer; v_cap integer; v_lim integer; v_tiers text[]; v_min integer;
  v_ids uuid[];
  n integer := 0;
BEGIN
  IF NOT p_dry_run THEN
    IF NOT pg_try_advisory_xact_lock(hashtext('dispatch_stale_derivations_v1')) THEN
      RAISE EXCEPTION 'dispatch_busy' USING ERRCODE = '55P03';
    END IF;
    PERFORM public.pipeline_catchup_tick_v1(false);
  END IF;
  ctrl := coalesce((SELECT value FROM public.app_settings WHERE key = 'derivation_dispatch_controls'), '{}'::jsonb);
  st := coalesce((SELECT value FROM public.app_settings WHERE key = 'derivation_dispatch_state'), '{}'::jsonb);
  tctrl := coalesce((SELECT value FROM public.app_settings WHERE key = 'episode_topic_extractor_controls'), '{}'::jsonb);
  v_cap := least(greatest(coalesce((ctrl->>'daily_cap')::int, 300), 0), 5000);
  v_tiers := coalesce(ARRAY(SELECT jsonb_array_elements_text(tctrl->'tier_filter')), ARRAY['S']);
  v_min := coalesce((tctrl->>'min_clean_chars')::int, 400);
  IF coalesce((ctrl->>'enabled')::boolean, false) IS NOT TRUE THEN RETURN; END IF;
  v_used := CASE WHEN st->>'day' = v_today THEN coalesce((st->>'dispatched_today')::int, 0) ELSE 0 END;
  v_lim := least(greatest(coalesce(p_limit, 20), 0), least(coalesce((ctrl->>'per_run')::int, 20), 60), greatest(v_cap - v_used, 0));
  IF v_lim <= 0 THEN RETURN; END IF;

  -- Newest dispatchable candidates, read from the partial index (no lock, no hashing yet).
  WITH cand AS MATERIALIZED (
    SELECT d.episode_id FROM public.episode_derivation_state d
     WHERE d.clean_usable AND d.dispatch_attempts < 3
       AND (d.entity_status IN ('stale', 'queued') OR d.topic_status IN ('stale', 'queued') OR d.seo_status IN ('stale', 'queued'))
  )
  SELECT array_agg(x.episode_id) INTO v_ids FROM (
    SELECT c0.episode_id
      FROM cand c0
      JOIN public.episode_derivation_state d ON d.episode_id = c0.episode_id
      JOIN public.episodes e ON e.id = c0.episode_id AND e.clean_text_status = 'done'
      JOIN public.podcasts p ON p.id = e.podcast_id AND p.language_decision = 'accept_hungarian'
     WHERE (d.entity_status = 'stale' OR d.topic_status = 'stale' OR d.seo_status = 'stale'
            OR ((d.entity_status = 'queued' OR d.topic_status = 'queued' OR d.seo_status = 'queued')
                AND d.last_dispatched_at < now() - interval '2 days'))
     ORDER BY e.published_at DESC NULLS LAST
     LIMIT v_lim * 3) x;
  IF v_ids IS NULL THEN RETURN; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _dispatch_act (
    episode_id uuid, podcast_id uuid, clean_hash text, overdue boolean, ai_entities_version int,
    v_topic text, v_entity text, v_seo boolean) ON COMMIT DROP;
  TRUNCATE _dispatch_act;
  INSERT INTO _dispatch_act
  SELECT s.episode_id, s.podcast_id, s.clean_hash, s.overdue, s.ai_entities_version,
         CASE WHEN s.topic_status = 'stale' OR (s.overdue AND s.topic_status = 'queued') THEN
           CASE WHEN NOT (s.rank_label = ANY (v_tiers)) THEN 'blocked:policy_tier_not_in_topic_extractor'
                WHEN s.clen < v_min THEN 'not_applicable:clean_text_below_topic_min'
                WHEN s.topic_extraction_status = 'in_progress' THEN 'busy'
                ELSE 'queued' END END,
         CASE WHEN s.entity_status = 'stale' OR (s.overdue AND s.entity_status = 'queued') THEN 'queued' END,
         (s.seo_status = 'stale' OR (s.overdue AND s.seo_status = 'queued'))
    FROM (
      SELECT d.episode_id, e.podcast_id, d.clean_hash, d.entity_status, d.topic_status, d.seo_status,
             (d.last_dispatched_at IS NOT NULL AND d.last_dispatched_at < now() - interval '2 days') AS overdue,
             e.topic_extraction_status, e.ai_entities_version, p.rank_label, e.published_at,
             length(btrim(coalesce(c.cleaned_text, ''))) AS clen, c.cleaned_text
        FROM public.episode_derivation_state d
        JOIN public.episodes e ON e.id = d.episode_id
        JOIN public.podcasts p ON p.id = e.podcast_id AND p.language_decision = 'accept_hungarian'
        JOIN public.episode_clean_text c ON c.episode_id = d.episode_id
       WHERE d.episode_id = ANY (v_ids)
         AND (d.entity_status = 'stale' OR d.topic_status = 'stale' OR d.seo_status = 'stale'
              OR ((d.entity_status = 'queued' OR d.topic_status = 'queued' OR d.seo_status = 'queued')
                  AND d.last_dispatched_at < now() - interval '2 days'))
         AND d.clean_usable AND d.dispatch_attempts < 3
         AND e.clean_text_status = 'done'
       ORDER BY e.published_at DESC NULLS LAST
       LIMIT v_lim * 2
       FOR UPDATE OF d SKIP LOCKED) s
   WHERE public.clean_text_content_hash(s.cleaned_text) = s.clean_hash
   ORDER BY s.published_at DESC NULLS LAST
   LIMIT v_lim;

  IF NOT p_dry_run THEN
    UPDATE public.episodes e SET
      topic_extraction_status = CASE WHEN a.v_topic = 'queued' THEN 'pending' ELSE e.topic_extraction_status END,
      ai_entities_version = CASE WHEN a.v_entity = 'queued' AND coalesce(e.ai_entities_version, 0) >= 5 THEN 4 ELSE e.ai_entities_version END
      FROM _dispatch_act a
     WHERE e.id = a.episode_id
       AND (a.v_topic = 'queued' OR (a.v_entity = 'queued' AND coalesce(e.ai_entities_version, 0) >= 5));
    UPDATE public.episode_derivation_state d SET
      topic_status = CASE WHEN a.v_topic = 'queued' THEN 'queued' WHEN a.v_topic LIKE 'blocked:%' THEN 'blocked' WHEN a.v_topic LIKE 'not_applicable:%' THEN 'not_applicable' ELSE d.topic_status END,
      topic_block_reason = CASE WHEN a.v_topic LIKE '%:%' THEN split_part(a.v_topic, ':', 2) ELSE d.topic_block_reason END,
      entity_status = CASE WHEN a.v_entity IS NOT NULL THEN 'queued' ELSE d.entity_status END,
      seo_status = CASE WHEN a.v_seo THEN 'queued' ELSE d.seo_status END,
      dispatch_attempts = CASE WHEN a.overdue THEN d.dispatch_attempts + 1 ELSE d.dispatch_attempts END,
      last_dispatched_at = now(), updated_at = now()
      FROM _dispatch_act a
     WHERE d.episode_id = a.episode_id;
  END IF;

  SELECT count(*) INTO n FROM _dispatch_act;
  IF NOT p_dry_run AND n > 0 THEN
    INSERT INTO public.app_settings(key, value, updated_at)
    VALUES ('derivation_dispatch_state', jsonb_build_object('day', v_today, 'dispatched_today', v_used + n, 'last_at', now(),
            'total', coalesce((st->>'total')::int, 0) + n), now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END IF;
  RETURN QUERY SELECT a.episode_id, a.podcast_id, coalesce(a.v_seo, false), a.v_topic, a.v_entity, a.clean_hash FROM _dispatch_act a;
END $function$;

-- Same eligibility, driven from the partial index; stops at p_cap verified rows.
CREATE OR REPLACE FUNCTION public.derivation_dispatch_eligible_count_v1(p_cap integer DEFAULT 10000)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cand AS MATERIALIZED (
    SELECT d.episode_id, d.clean_hash FROM public.episode_derivation_state d
     WHERE d.clean_usable AND d.dispatch_attempts < 3
       AND (d.entity_status IN ('stale', 'queued') OR d.topic_status IN ('stale', 'queued') OR d.seo_status IN ('stale', 'queued'))
       AND (d.entity_status = 'stale' OR d.topic_status = 'stale' OR d.seo_status = 'stale'
            OR ((d.entity_status = 'queued' OR d.topic_status = 'queued' OR d.seo_status = 'queued')
                AND d.last_dispatched_at < now() - interval '2 days'))
  )
  SELECT count(*)::int FROM (
    SELECT 1
      FROM cand d
      JOIN public.episodes e ON e.id = d.episode_id AND e.clean_text_status = 'done'
      JOIN public.podcasts p ON p.id = e.podcast_id AND p.language_decision = 'accept_hungarian'
      JOIN public.episode_clean_text c ON c.episode_id = d.episode_id
     WHERE public.clean_text_content_hash(c.cleaned_text) = d.clean_hash
     LIMIT greatest(1, least(coalesce(p_cap, 10000), 50000))) x;
$function$;

CREATE OR REPLACE FUNCTION public.extend_pipeline_catchup_v1(
  p_settings jsonb DEFAULT '[]'::jsonb, p_cron jsonb DEFAULT '[]'::jsonb,
  p_runner_cadence jsonb DEFAULT NULL, p_dispatch_tuning jsonb DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'cron' AS $$
DECLARE
  st jsonb; s jsonb; c jsonb; cur jsonb; v_sched text; v_jobid bigint; i int; found_i int;
  v_changes jsonb; v_cron jsonb; applied jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
  k text; v text;
  allowed_sched text[] := ARRAY['* * * * *', '*/2 * * * *', '*/3 * * * *', '*/5 * * * *'];
BEGIN
  IF NOT public.pipeline_catchup_caller_allowed_v1() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('pipeline_catchup_v1'));
  SELECT value INTO st FROM public.app_settings WHERE key = 'pipeline_catchup_state' FOR UPDATE;
  IF st IS NULL OR coalesce((st->>'active')::boolean, false) IS NOT TRUE OR now() >= (st->>'expires_at')::timestamptz THEN
    RAISE EXCEPTION 'no active catch-up to extend';
  END IF;
  v_changes := coalesce(st->'changes', '[]'::jsonb);
  v_cron := coalesce(st->'cron_changes', '[]'::jsonb);

  FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p_settings, '[]'::jsonb)) LOOP
    IF coalesce(s->>'group', '') NOT IN ('derivation', 'best_source') THEN RAISE EXCEPTION 'bad group %', s->>'group'; END IF;
    SELECT value->(s->>'path') INTO cur FROM public.app_settings WHERE key = s->>'key' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing setting %', s->>'key'; END IF;
    found_i := NULL;
    FOR i IN 0 .. jsonb_array_length(v_changes) - 1 LOOP
      IF v_changes->i->>'key' = s->>'key' AND v_changes->i->>'path' = s->>'path' THEN found_i := i; END IF;
    END LOOP;
    IF found_i IS NOT NULL AND cur IS DISTINCT FROM (v_changes->found_i->'new') THEN
      skipped := skipped || jsonb_build_object('key', s->>'key', 'path', s->>'path', 'current', cur, 'reason', 'changed after catch-up start; kept');
      CONTINUE;
    END IF;
    CONTINUE WHEN cur IS NOT DISTINCT FROM (s->'value');
    UPDATE public.app_settings SET value = jsonb_set(value, ARRAY[s->>'path'], s->'value', true), updated_at = now() WHERE key = s->>'key';
    IF found_i IS NOT NULL THEN
      v_changes := jsonb_set(v_changes, ARRAY[found_i::text, 'new'], s->'value');
    ELSE
      v_changes := v_changes || jsonb_build_object('group', s->>'group', 'key', s->>'key', 'path', s->>'path', 'old', coalesce(cur, 'null'::jsonb), 'new', s->'value');
    END IF;
    applied := applied || jsonb_build_object('key', s->>'key', 'path', s->>'path', 'from', cur, 'to', s->'value');
  END LOOP;

  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(p_cron, '[]'::jsonb)) LOOP
    IF coalesce(c->>'group', '') NOT IN ('derivation', 'best_source') THEN RAISE EXCEPTION 'bad group %', c->>'group'; END IF;
    IF NOT (c->>'schedule' = ANY (allowed_sched)) THEN RAISE EXCEPTION 'schedule not allowed: %', c->>'schedule'; END IF;
    SELECT jobid, schedule INTO v_jobid, v_sched FROM cron.job WHERE jobname = c->>'jobname';
    IF v_jobid IS NULL THEN RAISE EXCEPTION 'cron job % not found', c->>'jobname'; END IF;
    found_i := NULL;
    FOR i IN 0 .. jsonb_array_length(v_cron) - 1 LOOP
      IF v_cron->i->>'jobname' = c->>'jobname' THEN found_i := i; END IF;
    END LOOP;
    IF found_i IS NOT NULL AND v_sched <> v_cron->found_i->>'new' THEN
      skipped := skipped || jsonb_build_object('cron', c->>'jobname', 'current', v_sched, 'reason', 'changed after catch-up start; kept');
      CONTINUE;
    END IF;
    CONTINUE WHEN v_sched = c->>'schedule';
    PERFORM cron.alter_job(v_jobid, schedule := c->>'schedule');
    IF found_i IS NOT NULL THEN
      v_cron := jsonb_set(v_cron, ARRAY[found_i::text, 'new'], to_jsonb(c->>'schedule'));
    ELSE
      v_cron := v_cron || jsonb_build_object('group', c->>'group', 'jobname', c->>'jobname', 'old', v_sched, 'new', c->>'schedule');
    END IF;
    applied := applied || jsonb_build_object('cron', c->>'jobname', 'from', v_sched, 'to', c->>'schedule');
  END LOOP;

  IF p_runner_cadence IS NOT NULL THEN
    FOR k, v IN SELECT key, value #>> '{}' FROM jsonb_each(p_runner_cadence) LOOP
      IF NOT (v = ANY (allowed_sched)) THEN RAISE EXCEPTION 'runner cadence not allowed: %', v; END IF;
    END LOOP;
    st := st || jsonb_build_object('runner_cadence', p_runner_cadence);
    applied := applied || jsonb_build_object('runner_cadence', p_runner_cadence);
  END IF;
  IF p_dispatch_tuning IS NOT NULL THEN
    st := st || jsonb_build_object('dispatch_tuning', jsonb_build_object(
      'start_limit', least(greatest(coalesce((p_dispatch_tuning->>'start_limit')::int, 30), 10), 60),
      'grow_below_ms', least(greatest(coalesce((p_dispatch_tuning->>'grow_below_ms')::int, 3000), 1000), 6000),
      'shrink_above_ms', least(greatest(coalesce((p_dispatch_tuning->>'shrink_above_ms')::int, 5000), 2000), 7000)));
    applied := applied || jsonb_build_object('dispatch_tuning', st->'dispatch_tuning');
  END IF;

  st := st || jsonb_build_object('changes', v_changes, 'cron_changes', v_cron,
    'extensions', coalesce(st->'extensions', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'at', now(), 'reason', coalesce(p_reason, 'owner-approved throughput raise'), 'applied', applied, 'skipped', skipped)));
  UPDATE public.app_settings SET value = st, updated_at = now() WHERE key = 'pipeline_catchup_state';
  RETURN jsonb_build_object('applied', applied, 'skipped', skipped, 'expires_at', st->'expires_at');
END $$;

REVOKE ALL ON FUNCTION public.extend_pipeline_catchup_v1(jsonb, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.extend_pipeline_catchup_v1(jsonb, jsonb, jsonb, jsonb, text) FROM readonly_codex;
GRANT EXECUTE ON FUNCTION public.extend_pipeline_catchup_v1(jsonb, jsonb, jsonb, jsonb, text) TO service_role;
-- Recreated functions keep their ACLs; re-assert defense in depth for the dispatcher.
REVOKE ALL ON FUNCTION public.dispatch_stale_derivations_v1(integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_stale_derivations_v1(integer, boolean) FROM readonly_codex;
GRANT EXECUTE ON FUNCTION public.dispatch_stale_derivations_v1(integer, boolean) TO service_role;