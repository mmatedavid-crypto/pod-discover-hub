-- Temporary owner-approved catch-up for the pipeline repaired on 2026-10-24: higher dispatch
-- and verified YouTube/Spotify re-clean quotas for at most 24h. Every change is audited
-- (old/new), restored automatically at expiry (derivation part also as soon as nothing
-- eligible is left), and a restore never overwrites a value someone changed meanwhile.
-- Money budgets, AI concurrency, tier/quality/identity gates are not touched.

CREATE OR REPLACE FUNCTION public.pipeline_catchup_plan_v1()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'settings', jsonb_build_array(
      jsonb_build_object('group', 'derivation', 'key', 'derivation_dispatch_controls', 'path', 'daily_cap', 'value', 5000),
      jsonb_build_object('group', 'derivation', 'key', 'derivation_dispatch_controls', 'path', 'per_run', 'value', 60),
      jsonb_build_object('group', 'best_source', 'key', 'episode_best_text_source_controls', 'path', 'youtube_reclean_daily_cap', 'value', 1000),
      jsonb_build_object('group', 'best_source', 'key', 'episode_best_text_source_controls', 'path', 'youtube_reclean_per_run', 'value', 15),
      jsonb_build_object('group', 'best_source', 'key', 'episode_best_text_source_controls', 'path', 'spotify_reclean_daily_cap', 'value', 500),
      jsonb_build_object('group', 'best_source', 'key', 'episode_best_text_source_controls', 'path', 'spotify_reclean_per_run', 'value', 10)),
    'cron', jsonb_build_array(
      jsonb_build_object('group', 'derivation', 'jobname', 'podiverzum-seo-enrich-enqueue-5min', 'schedule', '*/5 * * * *')));
$$;

-- Episodes the dispatcher could still pick up (same eligibility as dispatch_stale_derivations_v1).
CREATE OR REPLACE FUNCTION public.derivation_dispatch_eligible_count_v1(p_cap integer DEFAULT 10000)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT count(*)::int FROM (
    SELECT 1
      FROM public.episode_derivation_state d
      JOIN public.episodes e ON e.id = d.episode_id
      JOIN public.podcasts p ON p.id = e.podcast_id AND p.language_decision = 'accept_hungarian'
      JOIN public.episode_clean_text c ON c.episode_id = d.episode_id
     WHERE (d.entity_status = 'stale' OR d.topic_status = 'stale' OR d.seo_status = 'stale'
            OR ((d.entity_status = 'queued' OR d.topic_status = 'queued' OR d.seo_status = 'queued')
                AND d.last_dispatched_at < now() - interval '2 days'))
       AND d.clean_usable AND d.dispatch_attempts < 3
       AND e.clean_text_status = 'done'
       AND public.clean_text_content_hash(c.cleaned_text) = d.clean_hash
     LIMIT greatest(1, least(coalesce(p_cap, 10000), 50000))) x;
$$;

CREATE OR REPLACE FUNCTION public.pipeline_catchup_restore_group_v1(p_state jsonb, p_group text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'cron' AS $$
DECLARE c jsonb; cur jsonb; v_sched text; v_jobid bigint; out jsonb := '[]'::jsonb;
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(p_state->'changes', '[]'::jsonb)) LOOP
    CONTINUE WHEN c->>'group' <> p_group;
    SELECT value->(c->>'path') INTO cur FROM public.app_settings WHERE key = c->>'key' FOR UPDATE;
    IF cur IS NOT DISTINCT FROM (c->'new') THEN
      UPDATE public.app_settings
         SET value = CASE WHEN c->'old' IS NULL OR c->'old' = 'null'::jsonb THEN value - (c->>'path')
                          ELSE jsonb_set(value, ARRAY[c->>'path'], c->'old', true) END,
             updated_at = now()
       WHERE key = c->>'key';
      out := out || jsonb_build_object('key', c->>'key', 'path', c->>'path', 'restored_to', c->'old');
    ELSE
      out := out || jsonb_build_object('key', c->>'key', 'path', c->>'path', 'kept_changed_value', cur, 'reason', 'changed after catch-up start');
    END IF;
  END LOOP;
  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(p_state->'cron_changes', '[]'::jsonb)) LOOP
    CONTINUE WHEN c->>'group' <> p_group;
    SELECT jobid, schedule INTO v_jobid, v_sched FROM cron.job WHERE jobname = c->>'jobname';
    IF v_jobid IS NOT NULL AND v_sched = c->>'new' THEN
      PERFORM cron.alter_job(v_jobid, schedule := c->>'old');
      out := out || jsonb_build_object('cron', c->>'jobname', 'restored_to', c->>'old');
    ELSE
      out := out || jsonb_build_object('cron', c->>'jobname', 'kept_changed_value', v_sched, 'reason', 'changed after catch-up start');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('group', p_group, 'at', now(), 'reason', p_reason, 'items', out);
END $$;

-- Ends the catch-up (whole or per group) when expired or when the derivation backlog is empty.
CREATE OR REPLACE FUNCTION public.pipeline_catchup_tick_v1(p_force_end boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'cron' AS $$
DECLARE st jsonb; v_restored jsonb; g text; v_reason text; v_jobid bigint; v_eligible int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('pipeline_catchup_v1'));
  SELECT value INTO st FROM public.app_settings WHERE key = 'pipeline_catchup_state' FOR UPDATE;
  IF st IS NULL OR coalesce((st->>'active')::boolean, false) IS NOT TRUE THEN RETURN coalesce(st, '{}'::jsonb); END IF;
  v_restored := coalesce(st->'restored', '[]'::jsonb);
  FOREACH g IN ARRAY ARRAY['derivation', 'best_source'] LOOP
    CONTINUE WHEN v_restored @> jsonb_build_array(jsonb_build_object('group', g));
    v_reason := NULL;
    IF p_force_end THEN v_reason := 'ended_manually';
    ELSIF now() >= (st->>'expires_at')::timestamptz THEN v_reason := 'expired';
    ELSIF g = 'derivation' THEN
      v_eligible := public.derivation_dispatch_eligible_count_v1(1);
      IF v_eligible = 0 THEN v_reason := 'eligible_backlog_empty'; END IF;
    END IF;
    IF v_reason IS NOT NULL THEN
      v_restored := v_restored || public.pipeline_catchup_restore_group_v1(st, g, v_reason);
    END IF;
  END LOOP;
  st := jsonb_set(st, '{restored}', v_restored, true);
  IF jsonb_array_length(v_restored) >= 2 THEN
    st := st || jsonb_build_object('active', false, 'ended_at', now());
    v_jobid := nullif(st->>'expiry_jobid', '')::bigint;
    IF v_jobid IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobid = v_jobid) THEN
      PERFORM cron.unschedule(v_jobid);
    END IF;
  END IF;
  UPDATE public.app_settings SET value = st, updated_at = now() WHERE key = 'pipeline_catchup_state';
  RETURN st;
END $$;

CREATE OR REPLACE FUNCTION public.start_pipeline_catchup_v1(p_hours integer DEFAULT 24, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'cron' AS $$
DECLARE
  v_plan jsonb := public.pipeline_catchup_plan_v1(); s jsonb; cur jsonb; v_changes jsonb := '[]'::jsonb;
  v_cron jsonb := '[]'::jsonb; v_sched text; v_jobid bigint; v_exp timestamptz; v_expjob bigint; st jsonb;
BEGIN
  IF NOT (current_user IN ('postgres', 'service_role', 'supabase_admin') OR public.has_role(auth.uid(), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('pipeline_catchup_v1'));
  SELECT value INTO st FROM public.app_settings WHERE key = 'pipeline_catchup_state';
  IF coalesce((st->>'active')::boolean, false) THEN RAISE EXCEPTION 'catch-up already active until %', st->>'expires_at'; END IF;
  v_exp := now() + make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 24));
  FOR s IN SELECT * FROM jsonb_array_elements(v_plan->'settings') LOOP
    SELECT value->(s->>'path') INTO cur FROM public.app_settings WHERE key = s->>'key' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing setting %', s->>'key'; END IF;
    CONTINUE WHEN cur IS NOT DISTINCT FROM (s->'value');
    UPDATE public.app_settings SET value = jsonb_set(value, ARRAY[s->>'path'], s->'value', true), updated_at = now() WHERE key = s->>'key';
    v_changes := v_changes || jsonb_build_object('group', s->>'group', 'key', s->>'key', 'path', s->>'path', 'old', coalesce(cur, 'null'::jsonb), 'new', s->'value');
  END LOOP;
  FOR s IN SELECT * FROM jsonb_array_elements(v_plan->'cron') LOOP
    SELECT jobid, schedule INTO v_jobid, v_sched FROM cron.job WHERE jobname = s->>'jobname';
    CONTINUE WHEN v_jobid IS NULL OR v_sched = s->>'schedule';
    PERFORM cron.alter_job(v_jobid, schedule := s->>'schedule');
    v_cron := v_cron || jsonb_build_object('group', s->>'group', 'jobname', s->>'jobname', 'old', v_sched, 'new', s->>'schedule');
  END LOOP;
  -- One-shot durable expiry (independent of any runner); removes itself when the catch-up ends.
  SELECT cron.schedule('pipeline-catchup-expiry',
    to_char(v_exp AT TIME ZONE 'UTC' + interval '1 minute', 'MI HH24 DD MM') || ' *',
    'SELECT public.pipeline_catchup_tick_v1(false);') INTO v_expjob;
  st := jsonb_build_object('active', true, 'started_at', now(), 'expires_at', v_exp,
    'reason', coalesce(p_reason, 'owner-approved catch-up after 2026-10-24 pipeline repair'),
    'changes', v_changes, 'cron_changes', v_cron, 'restored', '[]'::jsonb, 'expiry_jobid', v_expjob,
    'note', 'Restores at expiry (derivation part as soon as nothing eligible is left); a value changed after start is kept.');
  INSERT INTO public.app_settings(key, value, updated_at) VALUES ('pipeline_catchup_state', st, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN st;
END $$;

CREATE OR REPLACE FUNCTION public.end_pipeline_catchup_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'cron' AS $$
BEGIN
  IF NOT (current_user IN ('postgres', 'service_role', 'supabase_admin') OR public.has_role(auth.uid(), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN public.pipeline_catchup_tick_v1(true);
END $$;

REVOKE ALL ON FUNCTION public.pipeline_catchup_restore_group_v1(jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pipeline_catchup_tick_v1(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_pipeline_catchup_v1(integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_pipeline_catchup_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.derivation_dispatch_eligible_count_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pipeline_catchup_tick_v1(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_pipeline_catchup_v1(integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_pipeline_catchup_v1() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.derivation_dispatch_eligible_count_v1(integer) TO service_role;

-- Dispatcher: catch-up tick first, serialized (race-safe daily accounting), explicit 5000/day
-- and 60/run hard ceilings; eligibility and actions unchanged.
CREATE OR REPLACE FUNCTION public.dispatch_stale_derivations_v1(p_limit integer DEFAULT 20, p_dry_run boolean DEFAULT false)
 RETURNS TABLE(episode_id uuid, podcast_id uuid, seo_dispatch boolean, topic_action text, entity_action text, clean_hash text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  ctrl jsonb; st jsonb; tctrl jsonb;
  v_today text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  v_used integer; v_cap integer; v_lim integer; v_tiers text[]; v_min integer;
  r record;
  v_topic text; v_entity text; v_seo boolean; v_retry boolean;
  n integer := 0;
BEGIN
  IF NOT p_dry_run THEN
    PERFORM public.pipeline_catchup_tick_v1(false);
    PERFORM pg_advisory_xact_lock(hashtext('dispatch_stale_derivations_v1'));
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
  FOR r IN
    SELECT d.episode_id, e.podcast_id, d.clean_hash, d.entity_status, d.topic_status, d.seo_status,
           (d.last_dispatched_at IS NOT NULL AND d.last_dispatched_at < now() - interval '2 days') AS overdue,
           e.topic_extraction_status, e.ai_entities_version, p.rank_label,
           length(btrim(coalesce(c.cleaned_text, ''))) AS clen
      FROM public.episode_derivation_state d
      JOIN public.episodes e ON e.id = d.episode_id
      JOIN public.podcasts p ON p.id = e.podcast_id AND p.language_decision = 'accept_hungarian'
      JOIN public.episode_clean_text c ON c.episode_id = d.episode_id
     WHERE (d.entity_status = 'stale' OR d.topic_status = 'stale' OR d.seo_status = 'stale'
            OR ((d.entity_status = 'queued' OR d.topic_status = 'queued' OR d.seo_status = 'queued')
                AND d.last_dispatched_at < now() - interval '2 days'))
       AND d.clean_usable AND d.dispatch_attempts < 3
       AND e.clean_text_status = 'done'
       AND public.clean_text_content_hash(c.cleaned_text) = d.clean_hash
     ORDER BY e.published_at DESC NULLS LAST
     LIMIT v_lim
     FOR UPDATE OF d SKIP LOCKED
  LOOP
    v_retry := r.overdue;
    v_topic := NULL; v_entity := NULL; v_seo := false;
    IF r.topic_status = 'stale' OR (v_retry AND r.topic_status = 'queued') THEN
      IF NOT (r.rank_label = ANY (v_tiers)) THEN v_topic := 'blocked:policy_tier_not_in_topic_extractor';
      ELSIF r.clen < v_min THEN v_topic := 'not_applicable:clean_text_below_topic_min';
      ELSIF r.topic_extraction_status = 'in_progress' THEN v_topic := 'busy';
      ELSE v_topic := 'queued'; END IF;
    END IF;
    IF r.seo_status = 'stale' OR (v_retry AND r.seo_status = 'queued') THEN v_seo := true; END IF;
    IF r.entity_status = 'stale' OR (v_retry AND r.entity_status = 'queued') THEN v_entity := 'queued'; END IF;
    IF NOT p_dry_run THEN
      IF v_topic = 'queued' THEN
        UPDATE public.episodes SET topic_extraction_status = 'pending' WHERE id = r.episode_id;
      END IF;
      IF v_entity = 'queued' AND coalesce(r.ai_entities_version, 0) >= 5 THEN
        UPDATE public.episodes SET ai_entities_version = 4 WHERE id = r.episode_id;
      END IF;
      UPDATE public.episode_derivation_state SET
        topic_status = CASE WHEN v_topic = 'queued' THEN 'queued' WHEN v_topic LIKE 'blocked:%' THEN 'blocked' WHEN v_topic LIKE 'not_applicable:%' THEN 'not_applicable' ELSE topic_status END,
        topic_block_reason = CASE WHEN v_topic LIKE '%:%' THEN split_part(v_topic, ':', 2) ELSE topic_block_reason END,
        entity_status = CASE WHEN v_entity IS NOT NULL THEN 'queued' ELSE entity_status END,
        seo_status = CASE WHEN v_seo THEN 'queued' ELSE seo_status END,
        dispatch_attempts = CASE WHEN v_retry THEN dispatch_attempts + 1 ELSE dispatch_attempts END,
        last_dispatched_at = now(), updated_at = now()
      WHERE episode_derivation_state.episode_id = r.episode_id;
    END IF;
    n := n + 1;
    episode_id := r.episode_id; podcast_id := r.podcast_id; seo_dispatch := v_seo; topic_action := v_topic; entity_action := v_entity; clean_hash := r.clean_hash;
    RETURN NEXT;
  END LOOP;
  IF NOT p_dry_run AND n > 0 THEN
    INSERT INTO public.app_settings(key, value, updated_at)
    VALUES ('derivation_dispatch_state', jsonb_build_object('day', v_today, 'dispatched_today', v_used + n, 'last_at', now(),
            'total', coalesce((st->>'total')::int, 0) + n), now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END IF;
END $function$;

-- Admin health: show the catch-up (active, expiry, changed values, restores) honestly.
CREATE OR REPLACE FUNCTION public.get_pipeline_runner_health_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'cron' AS $$
DECLARE
  v_items jsonb; v_src_queue bigint; v_seo_pending bigint;
  v_pr_paused boolean := NOT public.person_review_tick_active();
  v_cu jsonb := (SELECT value FROM public.app_settings WHERE key = 'pipeline_catchup_state');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT count(*) INTO v_src_queue FROM public.episode_source_change_queue;
  SELECT count(*) INTO v_seo_pending FROM (SELECT 1 FROM public.ai_enrichment_jobs WHERE status = 'pending' AND kind = 'seo_episode' LIMIT 20001) x;
  v_items := jsonb_build_array(
    public.pipeline_runner_health_item_v1('best_text_source', 'episode-best-text-source-runner', '%best-text-source%', v_src_queue, 'episodes in the source-change queue', interval '15 minutes'),
    public.pipeline_runner_health_item_v1('seo_enrich_runner', 'seo-enrich-runner', '%seo-enrich-runner%', v_seo_pending, 'pending episode SEO jobs', interval '30 minutes'),
    public.pipeline_runner_health_item_v1('topic_extractor', 'episode-topic-extractor', '%topic-extractor%', NULL, 'see derivation freshness', interval '20 minutes'),
    public.pipeline_runner_health_item_v1('entity_backfill', 'entity-backfill-runner', '%entity-backfill%', NULL, 'see derivation freshness', interval '30 minutes'),
    public.pipeline_runner_health_item_v1('person_entity_extractor', 'person-entity-extractor', '%person-entity-extractor%', NULL, 'catalog cursor; unchanged episodes skipped', interval '5 minutes'),
    public.derivation_health_item_v1(),
    CASE WHEN v_pr_paused THEN jsonb_build_object('name', 'person_relevance_review', 'health', 'paused',
      'recommendation', 'Paid person relevance review (OpenAI batch tick) is paused by the owner; mentions stay pending/needs_review, never auto-accepted.')
    ELSE jsonb_build_object('name', 'person_relevance_review', 'health', 'green', 'recommendation', 'OpenAI batch tick active.') END
  );
  IF v_cu IS NOT NULL THEN
    v_items := v_items || jsonb_build_array(jsonb_build_object('name', 'catch_up',
      'health', CASE WHEN coalesce((v_cu->>'active')::boolean, false) THEN 'yellow' ELSE 'green' END,
      'recommendation', CASE WHEN coalesce((v_cu->>'active')::boolean, false)
        THEN 'Temporary catch-up quotas active until ' || (v_cu->>'expires_at') || '; restored automatically (derivation part when nothing eligible is left).'
        ELSE 'No catch-up active; last one ended ' || coalesce(v_cu->>'ended_at', '-') || '.' END,
      'catch_up', v_cu - 'note'));
  END IF;
  RETURN jsonb_build_object('generated_at', now(), 'version', 'pipeline_runner_health_v1',
    'summary', jsonb_build_object(
      'green', (SELECT count(*) FROM jsonb_array_elements(v_items) x WHERE x->>'health' = 'green'),
      'yellow', (SELECT count(*) FROM jsonb_array_elements(v_items) x WHERE x->>'health' = 'yellow'),
      'red', (SELECT count(*) FROM jsonb_array_elements(v_items) x WHERE x->>'health' = 'red'),
      'paused', (SELECT count(*) FROM jsonb_array_elements(v_items) x WHERE x->>'health' = 'paused')),
    'items', v_items);
END $$;