-- Pipeline repair round 2 (2026-10-24 review): exact input provenance, marking serialized
-- against clean-text writes, atomic result persistence (SEO / entity / topic), no old-version
-- clobbering, honest health (runner completions vs cron dispatch, derivation freshness),
-- no-op skip for the person extractor.

-- 0) Fingerprint: whitespace-normalized including leading/trailing newlines/tabs (btrim only
--    strips spaces, so a trailing newline used to count as a content change). Stored hashes
--    that matched the live text are re-keyed so no false invalidation or dispatch follows.
CREATE OR REPLACE FUNCTION public.clean_text_content_hash(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN n IS NULL OR n = '' THEN NULL ELSE encode(sha256(convert_to(n, 'UTF8')), 'hex') END
    FROM (SELECT btrim(regexp_replace(p_text, '\s+', ' ', 'g')) AS n) x
$$;

WITH k AS (
  SELECT d.episode_id, d.clean_hash AS old_h, public.clean_text_content_hash(c.cleaned_text) AS new_h
    FROM public.episode_derivation_state d
    JOIN public.episode_clean_text c ON c.episode_id = d.episode_id
   WHERE d.clean_hash IS NOT DISTINCT FROM (CASE WHEN c.cleaned_text IS NULL OR btrim(c.cleaned_text) = '' THEN NULL
           ELSE encode(sha256(convert_to(regexp_replace(btrim(c.cleaned_text), '\s+', ' ', 'g'), 'UTF8')), 'hex') END)
     AND d.clean_hash IS DISTINCT FROM public.clean_text_content_hash(c.cleaned_text))
UPDATE public.episode_derivation_state d SET
  clean_hash = k.new_h,
  entity_hash = CASE WHEN d.entity_hash = k.old_h THEN k.new_h ELSE d.entity_hash END,
  topic_hash  = CASE WHEN d.topic_hash  = k.old_h THEN k.new_h ELSE d.topic_hash END,
  seo_hash    = CASE WHEN d.seo_hash    = k.old_h THEN k.new_h ELSE d.seo_hash END
FROM k WHERE k.episode_id = d.episode_id;

-- 1) Decision core. Locks the clean-text row FOR SHARE (an UPDATE of cleaned_text must wait
--    until this transaction commits, and its trigger then sees what we wrote) and the
--    derivation row FOR UPDATE (same order the trigger uses: clean row, then state row).
CREATE OR REPLACE FUNCTION public.derivation_lock_decide_v1(p_stage text, p_episode_id uuid, p_used_hash text)
RETURNS TABLE(action text, live_hash text, clean_usable boolean, has_state boolean, stage_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_live text; v_usable boolean := false;
  s public.episode_derivation_state%ROWTYPE;
  v_has boolean; v_st text; v_h text;
BEGIN
  IF p_stage NOT IN ('entity','topic','seo') THEN RAISE EXCEPTION 'unknown stage %', p_stage; END IF;
  SELECT public.clean_text_content_hash(c.cleaned_text), length(btrim(coalesce(c.cleaned_text, ''))) >= 80
    INTO v_live, v_usable
    FROM public.episode_clean_text c WHERE c.episode_id = p_episode_id FOR SHARE;
  SELECT * INTO s FROM public.episode_derivation_state d WHERE d.episode_id = p_episode_id FOR UPDATE;
  v_has := FOUND;
  v_st := CASE p_stage WHEN 'entity' THEN s.entity_status WHEN 'topic' THEN s.topic_status ELSE s.seo_status END;
  v_h  := CASE p_stage WHEN 'entity' THEN s.entity_hash WHEN 'topic' THEN s.topic_hash ELSE s.seo_hash END;
  action := CASE
    WHEN p_used_hash IS NOT NULL AND p_used_hash = v_live THEN 'current'
    WHEN v_has AND v_st IN ('current','not_applicable','blocked') AND v_h IS NOT NULL AND v_h = v_live THEN 'superseded'
    WHEN v_has THEN 'stale_write'
    ELSE 'untracked' END;
  live_hash := v_live; clean_usable := coalesce(v_usable, false); has_state := v_has; stage_status := v_st;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.derivation_lock_decide_v1(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.derivation_lock_decide_v1(text, uuid, text) TO service_role;

-- 2) Outcome writer. Only an exact-version result becomes current/not_applicable/blocked;
--    an older-version result never overwrites the stage hash (stale, or kept queued for SEO
--    whose new-version job already exists); superseded/untracked leave state untouched.
CREATE OR REPLACE FUNCTION public.derivation_apply_outcome_v1(p_stage text, p_episode_id uuid, p_action text, p_result text,
  p_used_hash text, p_reason text, p_live text, p_usable boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_status text; v_pr boolean;
BEGIN
  IF p_action = 'current' THEN
    v_status := CASE coalesce(p_result, 'done') WHEN 'done' THEN 'current' WHEN 'not_applicable' THEN 'not_applicable' WHEN 'blocked' THEN 'blocked' ELSE NULL END;
    IF v_status IS NULL THEN RAISE EXCEPTION 'unknown result %', p_result; END IF;
    INSERT INTO public.episode_derivation_state(episode_id, clean_hash, clean_usable, baseline)
    VALUES (p_episode_id, p_live, coalesce(p_usable, false), 'runner_mark') ON CONFLICT (episode_id) DO NOTHING;
    IF p_stage = 'entity' THEN
      v_pr := public.person_review_tick_active();
      UPDATE public.episode_derivation_state SET entity_status = v_status, entity_hash = p_used_hash, entity_at = now(),
        entity_block_reason = CASE WHEN v_status <> 'current' THEN p_reason END,
        person_review_status = CASE WHEN v_status = 'current' THEN (CASE WHEN v_pr THEN 'queued_for_review' ELSE 'blocked' END) ELSE person_review_status END,
        person_review_block_reason = CASE WHEN v_status = 'current' THEN (CASE WHEN v_pr THEN NULL ELSE 'paid_person_review_tick_paused_by_owner' END) ELSE person_review_block_reason END,
        updated_at = now()
      WHERE episode_id = p_episode_id;
    ELSIF p_stage = 'topic' THEN
      UPDATE public.episode_derivation_state SET topic_status = v_status, topic_hash = p_used_hash, topic_at = now(),
        topic_block_reason = CASE WHEN v_status <> 'current' THEN p_reason END, updated_at = now()
      WHERE episode_id = p_episode_id;
    ELSE
      UPDATE public.episode_derivation_state SET seo_status = v_status, seo_hash = p_used_hash, seo_at = now(),
        seo_block_reason = CASE WHEN v_status <> 'current' THEN p_reason END, updated_at = now()
      WHERE episode_id = p_episode_id;
    END IF;
    RETURN 'applied_' || v_status;
  ELSIF p_action = 'stale_write' THEN
    IF p_stage = 'entity' THEN
      UPDATE public.episode_derivation_state SET entity_status = 'stale', updated_at = now() WHERE episode_id = p_episode_id;
    ELSIF p_stage = 'topic' THEN
      UPDATE public.episode_derivation_state SET topic_status = 'stale', updated_at = now() WHERE episode_id = p_episode_id;
    ELSE
      UPDATE public.episode_derivation_state SET seo_status = CASE WHEN seo_status = 'queued' THEN 'queued' ELSE 'stale' END, updated_at = now()
       WHERE episode_id = p_episode_id;
    END IF;
    RETURN 'applied_older_version';
  END IF;
  RETURN p_action;
END $$;
REVOKE ALL ON FUNCTION public.derivation_apply_outcome_v1(text, uuid, text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.derivation_apply_outcome_v1(text, uuid, text, text, text, text, text, boolean) TO service_role;

-- 3) Marking without a result write (skips / errors). Same serialization; an older version's
--    not_applicable/blocked never overrides a newer invalidation.
CREATE OR REPLACE FUNCTION public.mark_episode_derivation_v1(p_stage text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE it record; d record; v_out text; n jsonb := '{}'::jsonb;
BEGIN
  IF p_stage NOT IN ('entity','topic','seo') THEN RAISE EXCEPTION 'unknown stage %', p_stage; END IF;
  FOR it IN SELECT * FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) AS x(episode_id uuid, used_hash text, result text, reason text) LOOP
    IF it.episode_id IS NULL THEN CONTINUE; END IF;
    IF it.result = 'error' THEN
      UPDATE public.episode_derivation_state SET dispatch_attempts = dispatch_attempts + 1,
        last_error = left(coalesce(it.reason, 'error'), 300), updated_at = now()
       WHERE episode_id = it.episode_id;
      v_out := CASE WHEN FOUND THEN 'error_counted' ELSE 'untracked' END;
    ELSE
      SELECT * INTO d FROM public.derivation_lock_decide_v1(p_stage, it.episode_id, it.used_hash);
      IF coalesce(it.result, 'done') <> 'done' AND d.action <> 'current' THEN
        v_out := 'ignored_other_version';
      ELSE
        v_out := public.derivation_apply_outcome_v1(p_stage, it.episode_id, d.action, coalesce(it.result, 'done'), it.used_hash, it.reason, d.live_hash, d.clean_usable);
      END IF;
    END IF;
    n := jsonb_set(n, ARRAY[v_out], to_jsonb(coalesce((n->>v_out)::int, 0) + 1));
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.mark_episode_derivation_v1(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_episode_derivation_v1(text, jsonb) TO service_role;

-- 4) SEO result: episode fields + derivation state in one transaction.
--    p_primary: transcript | clean_text | description | unknown (legacy job without provenance).
--    Entity arrays from the SEO model are written only to episodes that never had entity
--    extraction (ai_entities_version < 2); evidence-backed (v5) entities are never replaced.
CREATE OR REPLACE FUNCTION public.apply_episode_seo_result_v1(p_episode_id uuid, p_used_hash text, p_primary text, p_fields jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d record; r public.episodes; v_indep boolean := (p_primary = 'transcript' AND p_used_hash IS NULL);
BEGIN
  SELECT * INTO d FROM public.derivation_lock_decide_v1('seo', p_episode_id, p_used_hash);
  IF d.action = 'superseded' AND NOT v_indep THEN RETURN 'superseded'; END IF;
  r := jsonb_populate_record(NULL::public.episodes, coalesce(p_fields, '{}'::jsonb));
  UPDATE public.episodes e SET
    seo_title = r.seo_title,
    seo_description = r.seo_description,
    ai_summary = r.ai_summary,
    ai_summary_source = r.ai_summary_source,
    ai_enriched_at = now(),
    people     = CASE WHEN coalesce(e.ai_entities_version, 0) < 2 AND p_fields ? 'people'    THEN r.people    ELSE e.people END,
    mentioned  = CASE WHEN coalesce(e.ai_entities_version, 0) < 2 AND p_fields ? 'mentioned' THEN r.mentioned ELSE e.mentioned END,
    companies  = CASE WHEN coalesce(e.ai_entities_version, 0) < 2 AND p_fields ? 'companies' THEN r.companies ELSE e.companies END,
    tickers    = CASE WHEN coalesce(e.ai_entities_version, 0) < 2 AND p_fields ? 'tickers'   THEN r.tickers   ELSE e.tickers END,
    topics     = CASE WHEN coalesce(e.ai_entities_version, 0) < 2 AND p_fields ? 'topics'    THEN r.topics    ELSE e.topics END,
    ai_entities_version = CASE WHEN coalesce(e.ai_entities_version, 0) < 2 AND r.ai_entities_version IS NOT NULL THEN r.ai_entities_version ELSE e.ai_entities_version END
  WHERE e.id = p_episode_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'episode_missing %', p_episode_id; END IF;
  IF v_indep THEN
    -- Transcript-primary result that did not read the clean text: independent of clean-text versions.
    IF d.has_state THEN
      UPDATE public.episode_derivation_state SET seo_status = 'not_applicable', seo_hash = d.live_hash, seo_at = now(),
        seo_block_reason = 'policy_seo_source_transcript', updated_at = now() WHERE episode_id = p_episode_id;
      RETURN 'applied_transcript_independent';
    END IF;
    RETURN 'untracked';
  END IF;
  RETURN public.derivation_apply_outcome_v1('seo', p_episode_id, d.action, 'done', p_used_hash, NULL, d.live_hash, d.clean_usable);
END $$;
REVOKE ALL ON FUNCTION public.apply_episode_seo_result_v1(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_episode_seo_result_v1(uuid, text, text, jsonb) TO service_role;

-- 5) Entity result: episode entity fields + machine org-map reset + state, atomically.
--    Reclassification decisions (episode_organization_map.source = 'reclassified_from_person')
--    are kept. A superseded result writes nothing and closes the re-claim (version 5).
CREATE OR REPLACE FUNCTION public.apply_episode_entities_v1(p_episode_id uuid, p_used_hash text, p_fields jsonb, p_result text DEFAULT 'done', p_reason text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d record; r public.episodes;
BEGIN
  IF coalesce(p_result, 'done') NOT IN ('done','not_applicable') THEN RAISE EXCEPTION 'unknown result %', p_result; END IF;
  SELECT * INTO d FROM public.derivation_lock_decide_v1('entity', p_episode_id, p_used_hash);
  IF d.action = 'superseded' THEN
    UPDATE public.episodes SET ai_entities_version = 5 WHERE id = p_episode_id AND coalesce(ai_entities_version, 0) < 5;
    RETURN 'superseded';
  END IF;
  r := jsonb_populate_record(NULL::public.episodes, coalesce(p_fields, '{}'::jsonb));
  UPDATE public.episodes e SET
    people        = CASE WHEN p_fields ? 'people'        THEN r.people        ELSE e.people END,
    mentioned     = CASE WHEN p_fields ? 'mentioned'     THEN r.mentioned     ELSE e.mentioned END,
    companies     = CASE WHEN p_fields ? 'companies'     THEN r.companies     ELSE e.companies END,
    organizations = CASE WHEN p_fields ? 'organizations' THEN r.organizations ELSE e.organizations END,
    tickers       = CASE WHEN p_fields ? 'tickers'       THEN r.tickers       ELSE e.tickers END,
    topics        = CASE WHEN p_fields ? 'topics'        THEN r.topics        ELSE e.topics END,
    entity_extraction_evidence = r.entity_extraction_evidence,
    ai_entities_version = 5
  WHERE e.id = p_episode_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'episode_missing %', p_episode_id; END IF;
  IF coalesce(p_result, 'done') = 'done' THEN
    DELETE FROM public.episode_organization_map WHERE episode_id = p_episode_id AND coalesce(source, '') <> 'reclassified_from_person';
  END IF;
  RETURN public.derivation_apply_outcome_v1('entity', p_episode_id, d.action, coalesce(p_result, 'done'), p_used_hash, p_reason, d.live_hash, d.clean_usable);
END $$;
REVOKE ALL ON FUNCTION public.apply_episode_entities_v1(uuid, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_episode_entities_v1(uuid, text, jsonb, text, text) TO service_role;

-- 6) Topic result: insert machine rows, replace only older machine rows (model IS NOT NULL),
--    mark the episode done and record the version, atomically. Empty input raises (no
--    "done" without persisted topics).
CREATE OR REPLACE FUNCTION public.apply_episode_topics_v1(p_episode_id uuid, p_used_hash text, p_rows jsonb, p_version integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d record; v_new uuid[];
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN RAISE EXCEPTION 'no_topic_rows'; END IF;
  SELECT * INTO d FROM public.derivation_lock_decide_v1('topic', p_episode_id, p_used_hash);
  IF d.action = 'superseded' THEN
    UPDATE public.episodes SET topic_extraction_status = 'done' WHERE id = p_episode_id AND topic_extraction_status = 'in_progress';
    RETURN 'superseded';
  END IF;
  WITH ins AS (
    INSERT INTO public.episode_extracted_topics(episode_id, raw_label, normalized_label, kind, confidence, rationale, model, extractor_version)
    SELECT p_episode_id, x.raw_label, x.normalized_label, coalesce(x.kind, 'subject'), x.confidence, x.rationale, x.model, p_version
      FROM jsonb_to_recordset(p_rows) AS x(raw_label text, normalized_label text, kind text, confidence numeric, rationale text, model text)
     WHERE coalesce(btrim(x.raw_label), '') <> '' AND x.model IS NOT NULL
    RETURNING id)
  SELECT array_agg(id) INTO v_new FROM ins;
  IF v_new IS NULL THEN RAISE EXCEPTION 'no_valid_topic_rows'; END IF;
  DELETE FROM public.episode_extracted_topics WHERE episode_id = p_episode_id AND model IS NOT NULL AND NOT (id = ANY (v_new));
  UPDATE public.episodes SET topic_extraction_status = 'done', topic_extraction_version = p_version, topic_extracted_at = now() WHERE id = p_episode_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'episode_missing %', p_episode_id; END IF;
  RETURN public.derivation_apply_outcome_v1('topic', p_episode_id, d.action, 'done', p_used_hash, NULL, d.live_hash, d.clean_usable);
END $$;
REVOKE ALL ON FUNCTION public.apply_episode_topics_v1(uuid, text, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_episode_topics_v1(uuid, text, jsonb, integer) TO service_role;

-- 7) Trigger: policy-based stage states (policy_* reasons) survive clean-text changes for
--    topic and SEO alike (e.g. tier policy, transcript-primary SEO).
CREATE OR REPLACE FUNCTION public.episode_clean_text_derivation_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_new text := public.clean_text_content_hash(NEW.cleaned_text);
  v_usable boolean := length(btrim(coalesce(NEW.cleaned_text, ''))) >= 80;
  e record;
  s public.episode_derivation_state%ROWTYPE;
  has_s boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND public.clean_text_content_hash(OLD.cleaned_text) IS NOT DISTINCT FROM v_new THEN
    UPDATE public.episode_derivation_state SET clean_method = NEW.cleaner_method, clean_source_type = NEW.source_type
     WHERE episode_id = NEW.episode_id AND (clean_method IS DISTINCT FROM NEW.cleaner_method OR clean_source_type IS DISTINCT FROM NEW.source_type);
    RETURN NEW;
  END IF;
  SELECT * INTO s FROM public.episode_derivation_state WHERE episode_id = NEW.episode_id FOR UPDATE;
  has_s := FOUND;
  IF has_s AND s.clean_hash IS NOT DISTINCT FROM v_new THEN RETURN NEW; END IF;
  SELECT ep.ai_enriched_at, ep.topic_extraction_status, ep.ai_entities_version INTO e FROM public.episodes ep WHERE ep.id = NEW.episode_id;
  INSERT INTO public.episode_derivation_state AS d (
    episode_id, clean_hash, clean_method, clean_source_type, clean_usable, clean_changed_at, clean_change_count,
    entity_status, entity_block_reason, topic_status, topic_block_reason, seo_status, seo_block_reason, dispatch_attempts, baseline, updated_at)
  VALUES (
    NEW.episode_id, v_new, NEW.cleaner_method, NEW.source_type, v_usable, now(), 1,
    public.derivation_stage_after_change(coalesce(e.ai_entities_version, 0) >= 5, NULL, NULL, v_new, v_usable),
    CASE WHEN v_usable THEN NULL ELSE 'clean_text_empty_or_too_short' END,
    public.derivation_stage_after_change(coalesce(e.topic_extraction_status, '') IN ('done','skipped_short','waiting_clean_text','skipped_no_text','error'), NULL, NULL, v_new, v_usable),
    CASE WHEN v_usable THEN NULL ELSE 'clean_text_empty_or_too_short' END,
    public.derivation_stage_after_change(e.ai_enriched_at IS NOT NULL, NULL, NULL, v_new, v_usable),
    CASE WHEN v_usable THEN NULL ELSE 'clean_text_empty_or_too_short' END,
    0, 'trigger', now())
  ON CONFLICT (episode_id) DO UPDATE SET
    clean_hash = EXCLUDED.clean_hash,
    clean_method = EXCLUDED.clean_method,
    clean_source_type = EXCLUDED.clean_source_type,
    clean_usable = EXCLUDED.clean_usable,
    clean_changed_at = now(),
    clean_change_count = d.clean_change_count + 1,
    entity_status = CASE WHEN d.entity_status = 'awaiting_initial' AND EXCLUDED.clean_usable THEN 'awaiting_initial'
      ELSE public.derivation_stage_after_change(true, d.entity_status, d.entity_hash, EXCLUDED.clean_hash, EXCLUDED.clean_usable) END,
    entity_block_reason = EXCLUDED.entity_block_reason,
    topic_status = CASE WHEN d.topic_status = 'awaiting_initial' AND EXCLUDED.clean_usable THEN 'awaiting_initial'
      WHEN d.topic_status IN ('blocked','not_applicable') AND d.topic_block_reason LIKE 'policy_%' AND EXCLUDED.clean_usable THEN d.topic_status
      ELSE public.derivation_stage_after_change(true, d.topic_status, d.topic_hash, EXCLUDED.clean_hash, EXCLUDED.clean_usable) END,
    topic_block_reason = CASE WHEN d.topic_status IN ('blocked','not_applicable') AND d.topic_block_reason LIKE 'policy_%' AND EXCLUDED.clean_usable THEN d.topic_block_reason ELSE EXCLUDED.topic_block_reason END,
    seo_status = CASE WHEN d.seo_status = 'awaiting_initial' AND EXCLUDED.clean_usable THEN 'awaiting_initial'
      WHEN d.seo_status IN ('blocked','not_applicable') AND d.seo_block_reason LIKE 'policy_%' AND EXCLUDED.clean_usable THEN d.seo_status
      ELSE public.derivation_stage_after_change(true, d.seo_status, d.seo_hash, EXCLUDED.clean_hash, EXCLUDED.clean_usable) END,
    seo_block_reason = CASE WHEN d.seo_status IN ('blocked','not_applicable') AND d.seo_block_reason LIKE 'policy_%' AND EXCLUDED.clean_usable THEN d.seo_block_reason ELSE EXCLUDED.seo_block_reason END,
    dispatch_attempts = 0,
    last_error = NULL,
    updated_at = now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.episode_clean_text_derivation_trg() FROM PUBLIC, anon, authenticated;

-- 8) Dispatch: entity re-extraction is always queued in its own runner (the SEO runner no
--    longer rewrites evidence-backed entities, so it cannot carry the entity stage).
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
END $$;
REVOKE ALL ON FUNCTION public.dispatch_stale_derivations_v1(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_stale_derivations_v1(integer, boolean) TO service_role;

-- 9) Person extractor input fingerprints: unchanged episodes are skipped (no rewrite churn).
CREATE TABLE IF NOT EXISTS public.person_extractor_episode_inputs (
  episode_id uuid PRIMARY KEY,
  input_fp text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.person_extractor_episode_inputs TO authenticated;
GRANT ALL ON public.person_extractor_episode_inputs TO service_role;
ALTER TABLE public.person_extractor_episode_inputs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read person extractor inputs" ON public.person_extractor_episode_inputs;
CREATE POLICY "Admins read person extractor inputs" ON public.person_extractor_episode_inputs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 10) Health: real runner completions (pipeline_runner_runs) vs cron dispatch.
CREATE OR REPLACE FUNCTION public.pipeline_runner_health_item_v1(p_name text, p_runner text, p_cron_pattern text,
  p_backlog bigint, p_backlog_label text, p_expected_every interval, p_paused_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'cron' AS $$
DECLARE
  v_last_ok timestamptz; v_last record; v_ok int; v_err int; v_killed int; v_running int;
  v_cron jsonb; v_disp timestamptz; v_disp_status text;
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
  SELECT jsonb_build_object('jobid', j.jobid, 'jobname', j.jobname, 'schedule', j.schedule, 'active', j.active)
    INTO v_cron FROM cron.job j WHERE j.jobname ILIKE p_cron_pattern ORDER BY j.active DESC, j.jobid LIMIT 1;
  SELECT r.start_time, r.status INTO v_disp, v_disp_status FROM cron.job_run_details r
   WHERE r.jobid = (v_cron->>'jobid')::bigint ORDER BY r.start_time DESC LIMIT 1;
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

CREATE OR REPLACE FUNCTION public.derivation_health_item_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_counts jsonb; v_reasons jsonb; v_last timestamptz; v_stale bigint; v_queued bigint; v_pr bigint;
  v_disp jsonb := coalesce((SELECT value FROM public.app_settings WHERE key = 'derivation_dispatch_state'), '{}'::jsonb);
  v_ctrl jsonb := coalesce((SELECT value FROM public.app_settings WHERE key = 'derivation_dispatch_controls'), '{}'::jsonb);
  v_health text := 'green'; v_rec text := 'OK';
BEGIN
  SELECT jsonb_object_agg(stage, by_status) INTO v_counts FROM (
    SELECT stage, jsonb_object_agg(status, n) AS by_status FROM (
      SELECT 'entity' stage, CASE WHEN entity_status = 'current' AND entity_hash IS NULL THEN 'current_inferred_no_hash' ELSE entity_status END status, count(*) n FROM public.episode_derivation_state GROUP BY 1, 2
      UNION ALL SELECT 'topic', CASE WHEN topic_status = 'current' AND topic_hash IS NULL THEN 'current_inferred_no_hash' ELSE topic_status END, count(*) FROM public.episode_derivation_state GROUP BY 1, 2
      UNION ALL SELECT 'seo', CASE WHEN seo_status = 'current' AND seo_hash IS NULL THEN 'current_inferred_no_hash' ELSE seo_status END, count(*) FROM public.episode_derivation_state GROUP BY 1, 2
    ) x GROUP BY stage) y;
  SELECT jsonb_object_agg(reason, n) INTO v_reasons FROM (
    SELECT reason, count(*) n FROM (
      SELECT 'entity:' || entity_block_reason reason FROM public.episode_derivation_state WHERE entity_status IN ('blocked','not_applicable') AND entity_block_reason IS NOT NULL
      UNION ALL SELECT 'topic:' || topic_block_reason FROM public.episode_derivation_state WHERE topic_status IN ('blocked','not_applicable') AND topic_block_reason IS NOT NULL
      UNION ALL SELECT 'seo:' || seo_block_reason FROM public.episode_derivation_state WHERE seo_status IN ('blocked','not_applicable') AND seo_block_reason IS NOT NULL
    ) r GROUP BY reason ORDER BY count(*) DESC LIMIT 12) z;
  SELECT greatest(max(entity_at), max(topic_at), max(seo_at)) INTO v_last FROM public.episode_derivation_state;
  SELECT count(*) FILTER (WHERE entity_status = 'stale' OR topic_status = 'stale' OR seo_status = 'stale'),
         count(*) FILTER (WHERE entity_status = 'queued' OR topic_status = 'queued' OR seo_status = 'queued'),
         count(*) FILTER (WHERE person_review_status = 'blocked')
    INTO v_stale, v_queued, v_pr FROM public.episode_derivation_state;
  IF coalesce((v_ctrl->>'enabled')::boolean, false) IS NOT TRUE THEN
    v_health := 'paused'; v_rec := 'Stale-result dispatch disabled in derivation_dispatch_controls.';
  ELSIF (v_stale + v_queued) > 0 AND (v_last IS NULL OR v_last < now() - interval '3 hours') THEN
    v_health := 'red'; v_rec := 'Stale/queued derived results but no stage completed in 3h.';
  ELSIF v_stale > 0 THEN
    v_health := 'yellow'; v_rec := 'Stale derived results drain at the daily dispatch cap through existing runner budgets.';
  END IF;
  RETURN jsonb_build_object('name', 'derivation_freshness', 'health', v_health, 'recommendation', v_rec,
    'by_stage', coalesce(v_counts, '{}'::jsonb), 'block_reasons', coalesce(v_reasons, '{}'::jsonb),
    'episodes_with_stale', v_stale, 'episodes_with_queued', v_queued,
    'person_review_blocked', v_pr, 'person_review_block_reason', CASE WHEN v_pr > 0 THEN 'paid_person_review_tick_paused_by_owner' END,
    'last_stage_completion_at', v_last,
    'dispatch', jsonb_build_object('day', v_disp->>'day', 'dispatched_today', v_disp->'dispatched_today', 'daily_cap', v_ctrl->'daily_cap', 'per_run', v_ctrl->'per_run', 'last_at', v_disp->>'last_at'),
    'backlog', v_stale + v_queued, 'backlog_label', 'episodes with stale or queued derived results (tracked since 2026-10-24)');
END $$;
REVOKE ALL ON FUNCTION public.derivation_health_item_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.derivation_health_item_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.get_pipeline_health_snapshot_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'cron' AS $$
DECLARE
  v_clean_pending bigint; v_best_missing bigint; v_youtube_due bigint; v_native_transcript bigint;
  v_chunk_missing bigint; v_person_pending bigint; v_org_public_unreviewed bigint;
  v_search_goldens bigint; v_weekly_posts bigint; v_items jsonb;
  v_src_queue bigint; v_seo_pending bigint; v_topic_pending bigint; v_entity_pending bigint;
  v_pr_paused boolean := NOT public.person_review_tick_active();
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Any promoted deterministic_v4 variant counts (deterministic_v4+youtube, +rescue_v1, ...).
  SELECT count(*) INTO v_clean_pending
  FROM public.episodes e JOIN public.podcasts p ON p.id = e.podcast_id
  WHERE p.is_hungarian = true AND p.language_decision = 'accept_hungarian'
    AND COALESCE(e.description, '') <> ''
    AND NOT EXISTS (SELECT 1 FROM public.episode_clean_text ct WHERE ct.episode_id = e.id AND ct.cleaner_method LIKE 'deterministic_v4%');

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
    AND ct.cleaner_method LIKE 'deterministic_v4%'
    AND NOT EXISTS (SELECT 1 FROM public.episode_chunks ch WHERE ch.episode_id = e.id);

  SELECT count(*) INTO v_person_pending FROM public.person_episode_mentions WHERE relevance_status IN ('pending', 'in_progress');
  SELECT count(*) INTO v_org_public_unreviewed FROM public.organizations WHERE is_public = true AND COALESCE(ai_review_status, 'pending') IN ('pending', 'needs_review');
  SELECT count(*) INTO v_search_goldens FROM public.search_golden_queries WHERE COALESCE(active, true) = true;
  SELECT count(*) INTO v_weekly_posts FROM public.editorial_posts WHERE published_at > now() - interval '14 days';
  SELECT count(*) INTO v_src_queue FROM public.episode_source_change_queue;
  SELECT count(*) INTO v_seo_pending FROM (SELECT 1 FROM public.ai_enrichment_jobs WHERE status = 'pending' AND kind = 'seo_episode' LIMIT 20001) x;
  SELECT count(*) INTO v_topic_pending FROM (SELECT 1 FROM public.episodes WHERE topic_extraction_status = 'pending' AND clean_text_status = 'done' LIMIT 20001) x;
  SELECT count(*) INTO v_entity_pending FROM (SELECT 1 FROM public.episodes WHERE (ai_entities_version IS NULL OR ai_entities_version < 5) AND clean_text_status = 'done' LIMIT 20001) x;

  v_items := jsonb_build_array(
    public.pipeline_health_item_v1('clean_text_v4', 'clean_text_autopilot', 'episode_clean_text_candidate_progress', '%clean-text%', v_clean_pending, 'HU episodes without deterministic_v4* clean text'),
    public.pipeline_runner_health_item_v1('best_text_source', 'episode-best-text-source-runner', '%best-text-source%', v_src_queue, 'episodes in the source-change queue', interval '15 minutes'),
    public.pipeline_runner_health_item_v1('seo_enrich_runner', 'seo-enrich-runner', '%seo-enrich-runner%', v_seo_pending, 'pending episode SEO jobs (capped 20000)', interval '30 minutes'),
    public.pipeline_runner_health_item_v1('topic_extractor', 'episode-topic-extractor', '%topic-extractor%', v_topic_pending, 'episodes pending topic extraction (all tiers; capped 20000)', interval '20 minutes'),
    public.pipeline_runner_health_item_v1('entity_backfill', 'entity-backfill-runner', '%entity-backfill%', v_entity_pending, 'clean episodes without v5 evidence entities (capped 20000)', interval '30 minutes'),
    public.pipeline_runner_health_item_v1('person_entity_extractor', 'person-entity-extractor', '%person-entity-extractor%', NULL, 'catalog cursor; unchanged episodes skipped', interval '5 minutes'),
    public.derivation_health_item_v1(),
    public.pipeline_health_item_v1('youtube_episode_pairer', 'youtube_episode_pairer_controls', 'youtube_episode_pairer_progress', '%youtube%pair%', v_youtube_due, 'HU podcasts due for YouTube episode pairing'),
    public.pipeline_health_item_v1('native_transcript_fetch', 'youtube_transcript_controls', 'youtube_transcript_progress', '%transcript%', v_native_transcript, 'confirmed YouTube episodes with native captions not fetched'),
    public.pipeline_health_item_v1('episode_chunk_embeddings', 'embed_episode_chunks_controls', 'embed_episode_chunks_progress', '%embed%episode%chunk%', v_chunk_missing, 'clean HU episodes without episode chunks'),
    CASE WHEN v_pr_paused THEN jsonb_build_object('name', 'person_relevance_review', 'health', 'paused',
        'recommendation', 'Paid person relevance review (OpenAI batch tick) is paused by the owner; mentions stay pending/needs_review, never auto-accepted.',
        'backlog', v_person_pending, 'backlog_label', 'person mentions pending relevance judgment')
      ELSE public.pipeline_health_item_v1('person_relevance_judge', 'person_relevance_judge_controls', 'person_relevance_judge_progress', '%person%relevance%', v_person_pending, 'person mentions pending relevance judgment') END,
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
      'red', (SELECT count(*) FROM jsonb_array_elements(v_items) x WHERE x->>'health' = 'red'),
      'paused', (SELECT count(*) FROM jsonb_array_elements(v_items) x WHERE x->>'health' = 'paused')
    ),
    'items', v_items
  );
END $$;