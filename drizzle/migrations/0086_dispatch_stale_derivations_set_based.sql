-- Set-based writes: the row-by-row loop needed ~6.8 s for 60 episodes and hit the API statement
-- timeout once per_run was raised; three set-based statements do the same work in ~0.5 s.
-- Eligibility, actions, ceilings (60/run, 5000/day), catch-up tick and serialization unchanged.
CREATE OR REPLACE FUNCTION public.dispatch_stale_derivations_v1(p_limit integer DEFAULT 20, p_dry_run boolean DEFAULT false)
 RETURNS TABLE(episode_id uuid, podcast_id uuid, seo_dispatch boolean, topic_action text, entity_action text, clean_hash text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  ctrl jsonb; st jsonb; tctrl jsonb;
  v_today text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  v_used integer; v_cap integer; v_lim integer; v_tiers text[]; v_min integer;
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
       FOR UPDATE OF d SKIP LOCKED) s;

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