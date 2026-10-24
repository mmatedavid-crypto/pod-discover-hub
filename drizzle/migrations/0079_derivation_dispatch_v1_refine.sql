CREATE OR REPLACE FUNCTION public.person_review_tick_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'person-relevance-openai-batch-tick' AND active)
$$;
REVOKE ALL ON FUNCTION public.person_review_tick_active() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.person_review_tick_active() TO service_role;

CREATE OR REPLACE FUNCTION public.mark_episode_derivation_v1(p_stage text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  it record;
  v_live text;
  v_status text;
  v_pr boolean := public.person_review_tick_active();
  n_current integer := 0; n_stale integer := 0; n_other integer := 0;
BEGIN
  IF p_stage NOT IN ('entity','topic','seo') THEN RAISE EXCEPTION 'unknown stage %', p_stage; END IF;
  FOR it IN SELECT * FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
           AS x(episode_id uuid, used_hash text, result text, reason text) LOOP
    IF it.episode_id IS NULL THEN CONTINUE; END IF;
    SELECT public.clean_text_content_hash(c.cleaned_text) INTO v_live FROM public.episode_clean_text c WHERE c.episode_id = it.episode_id;
    IF NOT EXISTS (SELECT 1 FROM public.episode_derivation_state WHERE episode_id = it.episode_id) THEN
      IF it.used_hash IS NULL THEN CONTINUE; END IF;
      INSERT INTO public.episode_derivation_state(episode_id, clean_hash, clean_usable, baseline)
      SELECT it.episode_id, v_live, length(btrim(coalesce(c.cleaned_text, ''))) >= 80, 'runner_mark'
        FROM public.episode_clean_text c WHERE c.episode_id = it.episode_id
      ON CONFLICT (episode_id) DO NOTHING;
    END IF;
    v_status := CASE
      WHEN coalesce(it.result, 'done') = 'done' AND it.used_hash IS NOT NULL AND it.used_hash = v_live THEN 'current'
      WHEN coalesce(it.result, 'done') = 'done' THEN 'stale'
      WHEN it.result = 'not_applicable' THEN 'not_applicable'
      WHEN it.result = 'blocked' THEN 'blocked'
      ELSE NULL END;
    IF v_status = 'current' THEN n_current := n_current + 1; ELSIF v_status = 'stale' THEN n_stale := n_stale + 1; ELSE n_other := n_other + 1; END IF;
    IF p_stage = 'entity' THEN
      UPDATE public.episode_derivation_state SET
        entity_status = coalesce(v_status, entity_status),
        entity_hash = CASE WHEN v_status IS NOT NULL THEN it.used_hash ELSE entity_hash END,
        entity_at = CASE WHEN v_status IS NOT NULL THEN now() ELSE entity_at END,
        entity_block_reason = CASE WHEN v_status IN ('blocked','not_applicable') THEN it.reason ELSE NULL END,
        person_review_status = CASE WHEN v_status = 'current' THEN (CASE WHEN v_pr THEN 'queued_for_review' ELSE 'blocked' END) ELSE person_review_status END,
        person_review_block_reason = CASE WHEN v_status = 'current' THEN (CASE WHEN v_pr THEN NULL ELSE 'paid_person_review_tick_paused_by_owner' END) ELSE person_review_block_reason END,
        dispatch_attempts = CASE WHEN it.result = 'error' THEN dispatch_attempts + 1 ELSE dispatch_attempts END,
        last_error = CASE WHEN it.result = 'error' THEN left(it.reason, 300) ELSE last_error END,
        updated_at = now()
      WHERE episode_id = it.episode_id;
    ELSIF p_stage = 'topic' THEN
      UPDATE public.episode_derivation_state SET
        topic_status = coalesce(v_status, topic_status),
        topic_hash = CASE WHEN v_status IS NOT NULL THEN it.used_hash ELSE topic_hash END,
        topic_at = CASE WHEN v_status IS NOT NULL THEN now() ELSE topic_at END,
        topic_block_reason = CASE WHEN v_status IN ('blocked','not_applicable') THEN it.reason ELSE NULL END,
        dispatch_attempts = CASE WHEN it.result = 'error' THEN dispatch_attempts + 1 ELSE dispatch_attempts END,
        last_error = CASE WHEN it.result = 'error' THEN left(it.reason, 300) ELSE last_error END,
        updated_at = now()
      WHERE episode_id = it.episode_id;
    ELSE
      UPDATE public.episode_derivation_state SET
        seo_status = coalesce(v_status, seo_status),
        seo_hash = CASE WHEN v_status IS NOT NULL THEN it.used_hash ELSE seo_hash END,
        seo_at = CASE WHEN v_status IS NOT NULL THEN now() ELSE seo_at END,
        seo_block_reason = CASE WHEN v_status IN ('blocked','not_applicable') THEN it.reason ELSE NULL END,
        dispatch_attempts = CASE WHEN it.result = 'error' THEN dispatch_attempts + 1 ELSE dispatch_attempts END,
        last_error = CASE WHEN it.result = 'error' THEN left(it.reason, 300) ELSE last_error END,
        updated_at = now()
      WHERE episode_id = it.episode_id;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('current', n_current, 'stale', n_stale, 'other', n_other);
END $$;
REVOKE ALL ON FUNCTION public.mark_episode_derivation_v1(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_episode_derivation_v1(text, jsonb) TO service_role;

-- Refined dispatch: entity re-extraction rides on the SEO run when SEO is also stale
-- (the SEO runner already re-opens entity extraction), so the AI entity call happens once.
-- Rows left 'queued' for > 2 days are re-dispatched with a counted attempt (max 3).
CREATE OR REPLACE FUNCTION public.dispatch_stale_derivations_v1(p_limit integer DEFAULT 20, p_dry_run boolean DEFAULT false)
RETURNS TABLE(episode_id uuid, podcast_id uuid, seo_dispatch boolean, topic_action text, entity_action text, clean_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  ctrl jsonb := coalesce((SELECT value FROM public.app_settings WHERE key = 'derivation_dispatch_controls'), '{}'::jsonb);
  st jsonb := coalesce((SELECT value FROM public.app_settings WHERE key = 'derivation_dispatch_state'), '{}'::jsonb);
  tctrl jsonb := coalesce((SELECT value FROM public.app_settings WHERE key = 'episode_topic_extractor_controls'), '{}'::jsonb);
  v_today text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  v_used integer;
  v_cap integer := least(greatest(coalesce((ctrl->>'daily_cap')::int, 300), 0), 1000);
  v_lim integer;
  v_tiers text[] := coalesce(ARRAY(SELECT jsonb_array_elements_text(tctrl->'tier_filter')), ARRAY['S']);
  v_min integer := coalesce((tctrl->>'min_clean_chars')::int, 400);
  r record;
  v_topic text; v_entity text; v_seo boolean; v_retry boolean;
  n integer := 0;
BEGIN
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
    IF r.entity_status = 'stale' OR (v_retry AND r.entity_status = 'queued') THEN
      v_entity := CASE WHEN v_seo THEN 'via_seo' ELSE 'queued' END;
    END IF;
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
END $$;
REVOKE ALL ON FUNCTION public.dispatch_stale_derivations_v1(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_stale_derivations_v1(integer, boolean) TO service_role;
