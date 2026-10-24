-- Pipeline repair 2026-10-24: runner run log + item blocks, fast-lane release,
-- clean-text content fingerprint -> per-episode derivation state, bounded stale dispatch.

CREATE TABLE public.pipeline_runner_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text NOT NULL DEFAULT 'running' CHECK (outcome IN ('running','ok','error','killed')),
  stage text,
  stage_ms jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_limit integer,
  target_ids uuid[],
  error text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.pipeline_runner_runs TO authenticated;
GRANT ALL ON public.pipeline_runner_runs TO service_role;
ALTER TABLE public.pipeline_runner_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read runner runs" ON public.pipeline_runner_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX pipeline_runner_runs_runner_started_idx ON public.pipeline_runner_runs (runner, started_at DESC);

CREATE TABLE public.pipeline_item_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner text NOT NULL,
  item_kind text NOT NULL,
  item_id uuid NOT NULL,
  reason text NOT NULL,
  stage text,
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz
);
GRANT SELECT ON public.pipeline_item_blocks TO authenticated;
GRANT ALL ON public.pipeline_item_blocks TO service_role;
ALTER TABLE public.pipeline_item_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read item blocks" ON public.pipeline_item_blocks FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE UNIQUE INDEX pipeline_item_blocks_active_uq ON public.pipeline_item_blocks (runner, item_kind, item_id) WHERE cleared_at IS NULL;

CREATE OR REPLACE FUNCTION public.release_episode_source_changes_v1(p_lease_token uuid, p_items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n integer;
BEGIN
  IF p_lease_token IS NULL THEN RAISE EXCEPTION 'lease_token required'; END IF;
  WITH it AS (SELECT x.episode_id FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) AS x(episode_id uuid)),
  rel AS (
    UPDATE public.episode_source_change_queue q
       SET lease_token = NULL, leased_until = NULL, available_at = now(), attempts = greatest(q.attempts - 1, 0)
      FROM it WHERE q.episode_id = it.episode_id AND q.lease_token = p_lease_token
    RETURNING 1)
  SELECT count(*) INTO n FROM rel;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.release_episode_source_changes_v1(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_episode_source_changes_v1(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.clean_text_content_hash(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_text IS NULL OR btrim(p_text) = '' THEN NULL
    ELSE encode(sha256(convert_to(regexp_replace(btrim(p_text), '\s+', ' ', 'g'), 'UTF8')), 'hex') END
$$;

CREATE TABLE public.episode_derivation_state (
  episode_id uuid PRIMARY KEY,
  clean_hash text,
  clean_method text,
  clean_source_type text,
  clean_usable boolean NOT NULL DEFAULT false,
  clean_changed_at timestamptz,
  clean_change_count integer NOT NULL DEFAULT 0,
  entity_status text NOT NULL DEFAULT 'awaiting_initial',
  entity_hash text, entity_at timestamptz, entity_block_reason text,
  topic_status text NOT NULL DEFAULT 'awaiting_initial',
  topic_hash text, topic_at timestamptz, topic_block_reason text,
  seo_status text NOT NULL DEFAULT 'awaiting_initial',
  seo_hash text, seo_at timestamptz, seo_block_reason text,
  person_review_status text, person_review_block_reason text,
  dispatch_attempts integer NOT NULL DEFAULT 0,
  last_dispatched_at timestamptz,
  last_error text,
  baseline text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eds_entity_status_chk CHECK (entity_status IN ('awaiting_initial','current','stale','queued','blocked','not_applicable')),
  CONSTRAINT eds_topic_status_chk CHECK (topic_status IN ('awaiting_initial','current','stale','queued','blocked','not_applicable')),
  CONSTRAINT eds_seo_status_chk CHECK (seo_status IN ('awaiting_initial','current','stale','queued','blocked','not_applicable'))
);
COMMENT ON TABLE public.episode_derivation_state IS 'Per-episode versions of clean text and derived results (entity/topic/SEO). Rows exist only for episodes whose clean text was created or changed in content after 2026-10-24, or proven changed by repair backups; no row = baseline unknown, treated as current.';
GRANT SELECT ON public.episode_derivation_state TO authenticated;
GRANT ALL ON public.episode_derivation_state TO service_role;
ALTER TABLE public.episode_derivation_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read derivation state" ON public.episode_derivation_state FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX eds_stale_idx ON public.episode_derivation_state (clean_changed_at DESC)
  WHERE entity_status = 'stale' OR topic_status = 'stale' OR seo_status = 'stale';

CREATE OR REPLACE FUNCTION public.derivation_stage_after_change(p_has_output boolean, p_prev_status text, p_prev_hash text, p_new_hash text, p_usable boolean)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_prev_hash IS NOT NULL AND p_prev_hash = p_new_hash THEN 'current'
    WHEN NOT p_usable THEN 'blocked'
    WHEN p_has_output THEN 'stale'
    ELSE 'awaiting_initial' END
$$;

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
      WHEN d.topic_status = 'blocked' AND d.topic_block_reason LIKE 'policy_%' AND EXCLUDED.clean_usable THEN 'blocked'
      ELSE public.derivation_stage_after_change(true, d.topic_status, d.topic_hash, EXCLUDED.clean_hash, EXCLUDED.clean_usable) END,
    topic_block_reason = CASE WHEN d.topic_status = 'blocked' AND d.topic_block_reason LIKE 'policy_%' AND EXCLUDED.clean_usable THEN d.topic_block_reason ELSE EXCLUDED.topic_block_reason END,
    seo_status = CASE WHEN d.seo_status = 'awaiting_initial' AND EXCLUDED.clean_usable THEN 'awaiting_initial'
      ELSE public.derivation_stage_after_change(true, d.seo_status, d.seo_hash, EXCLUDED.clean_hash, EXCLUDED.clean_usable) END,
    seo_block_reason = EXCLUDED.seo_block_reason,
    dispatch_attempts = 0,
    last_error = NULL,
    updated_at = now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.episode_clean_text_derivation_trg() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_episode_clean_text_derivation
AFTER INSERT OR UPDATE OF cleaned_text ON public.episode_clean_text
FOR EACH ROW EXECUTE FUNCTION public.episode_clean_text_derivation_trg();

CREATE OR REPLACE FUNCTION public.get_episode_derivation_inputs_v1(p_ids uuid[])
RETURNS TABLE(episode_id uuid, cleaned_text text, cleaner_method text, quality_status text, clean_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.episode_id, c.cleaned_text, c.cleaner_method, c.quality_status, public.clean_text_content_hash(c.cleaned_text)
    FROM public.episode_clean_text c
   WHERE c.episode_id = ANY (coalesce(p_ids, '{}'::uuid[]))
   LIMIT 500
$$;
REVOKE ALL ON FUNCTION public.get_episode_derivation_inputs_v1(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_episode_derivation_inputs_v1(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_episode_derivation_v1(p_stage text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  it record;
  v_live text;
  v_status text;
  n_current integer := 0; n_stale integer := 0; n_other integer := 0;
BEGIN
  IF p_stage NOT IN ('entity','topic','seo') THEN RAISE EXCEPTION 'unknown stage %', p_stage; END IF;
  FOR it IN SELECT * FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
           AS x(episode_id uuid, used_hash text, result text, reason text, person_review text) LOOP
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
        person_review_status = coalesce(it.person_review, person_review_status),
        person_review_block_reason = CASE WHEN it.person_review = 'blocked' THEN 'paid_person_review_paused_by_owner' ELSE person_review_block_reason END,
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
  v_topic text; v_entity text; v_seo boolean;
  n integer := 0;
BEGIN
  IF coalesce((ctrl->>'enabled')::boolean, false) IS NOT TRUE THEN RETURN; END IF;
  v_used := CASE WHEN st->>'day' = v_today THEN coalesce((st->>'dispatched_today')::int, 0) ELSE 0 END;
  v_lim := least(greatest(coalesce(p_limit, 20), 0), least(coalesce((ctrl->>'per_run')::int, 20), 60), greatest(v_cap - v_used, 0));
  IF v_lim <= 0 THEN RETURN; END IF;
  FOR r IN
    SELECT d.episode_id, e.podcast_id, d.clean_hash, d.entity_status, d.topic_status, d.seo_status,
           e.topic_extraction_status, e.ai_entities_version, e.clean_text_status, p.rank_label,
           length(btrim(coalesce(c.cleaned_text, ''))) AS clen
      FROM public.episode_derivation_state d
      JOIN public.episodes e ON e.id = d.episode_id
      JOIN public.podcasts p ON p.id = e.podcast_id AND p.language_decision = 'accept_hungarian'
      JOIN public.episode_clean_text c ON c.episode_id = d.episode_id
     WHERE (d.entity_status = 'stale' OR d.topic_status = 'stale' OR d.seo_status = 'stale')
       AND d.clean_usable AND d.dispatch_attempts < 3
       AND e.clean_text_status = 'done'
       AND public.clean_text_content_hash(c.cleaned_text) = d.clean_hash
     ORDER BY e.published_at DESC NULLS LAST
     LIMIT v_lim
     FOR UPDATE OF d SKIP LOCKED
  LOOP
    v_topic := NULL; v_entity := NULL; v_seo := false;
    IF r.topic_status = 'stale' THEN
      IF NOT (r.rank_label = ANY (v_tiers)) THEN v_topic := 'blocked:policy_tier_not_in_topic_extractor';
      ELSIF r.clen < v_min THEN v_topic := 'not_applicable:clean_text_below_topic_min';
      ELSIF r.topic_extraction_status = 'in_progress' THEN v_topic := 'busy';
      ELSE v_topic := 'queued'; END IF;
    END IF;
    IF r.entity_status = 'stale' THEN v_entity := 'queued'; END IF;
    IF r.seo_status = 'stale' THEN v_seo := true; END IF;
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
        entity_status = CASE WHEN v_entity = 'queued' THEN 'queued' ELSE entity_status END,
        seo_status = CASE WHEN v_seo THEN 'queued' ELSE seo_status END,
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

INSERT INTO public.episode_derivation_state (
  episode_id, clean_hash, clean_method, clean_source_type, clean_usable, clean_changed_at, clean_change_count,
  entity_status, topic_status, topic_block_reason, seo_status, baseline)
SELECT b.episode_id, public.clean_text_content_hash(c.cleaned_text), c.cleaner_method, c.source_type,
       length(btrim(coalesce(c.cleaned_text, ''))) >= 80, b.changed_at, 1,
       CASE WHEN coalesce(e.ai_entities_version, 0) < 5 THEN 'awaiting_initial'
            WHEN coalesce(e.entity_extraction_evidence->>'extracted_at', '') = '' THEN 'stale'
            WHEN (e.entity_extraction_evidence->>'extracted_at')::timestamptz < b.changed_at THEN 'stale' ELSE 'current' END,
       CASE WHEN e.topic_extraction_status = 'done' AND (e.topic_extracted_at IS NULL OR e.topic_extracted_at < b.changed_at) THEN 'stale'
            WHEN e.topic_extraction_status = 'done' THEN 'current'
            WHEN e.topic_extraction_status IN ('skipped_short','skipped_no_text','waiting_clean_text','error') THEN 'stale'
            ELSE 'awaiting_initial' END,
       NULL,
       CASE WHEN e.ai_enriched_at IS NULL THEN 'awaiting_initial'
            WHEN e.ai_enriched_at < b.changed_at THEN 'stale' ELSE 'current' END,
       'repair_backup_proven_change_2026_10_24'
  FROM (
    SELECT bk.episode_id, max(bk.applied_at) AS changed_at,
           bool_or(public.clean_text_content_hash(bk.old_row->>'cleaned_text') IS DISTINCT FROM public.clean_text_content_hash(cc.cleaned_text)) AS changed
      FROM public.episode_clean_text_repair_backups bk
      JOIN public.episode_clean_text cc ON cc.episode_id = bk.episode_id
     WHERE bk.rolled_back_at IS NULL
     GROUP BY bk.episode_id
  ) b
  JOIN public.episode_clean_text c ON c.episode_id = b.episode_id
  JOIN public.episodes e ON e.id = b.episode_id
 WHERE b.changed
ON CONFLICT (episode_id) DO NOTHING;

UPDATE public.episode_derivation_state SET
  entity_status = CASE WHEN entity_status IN ('stale','awaiting_initial') THEN 'blocked' ELSE entity_status END,
  topic_status = CASE WHEN topic_status IN ('stale','awaiting_initial') THEN 'blocked' ELSE topic_status END,
  seo_status = CASE WHEN seo_status IN ('stale','awaiting_initial') THEN 'blocked' ELSE seo_status END,
  entity_block_reason = 'clean_text_empty_or_too_short', topic_block_reason = 'clean_text_empty_or_too_short', seo_block_reason = 'clean_text_empty_or_too_short'
WHERE baseline = 'repair_backup_proven_change_2026_10_24' AND NOT clean_usable;

UPDATE public.episode_clean_text_repair_backups bk SET downstream_invalidation = 'tracked_in_episode_derivation_state'
 WHERE bk.rolled_back_at IS NULL AND bk.downstream_invalidation = 'pending'
   AND EXISTS (SELECT 1 FROM public.episode_derivation_state d WHERE d.episode_id = bk.episode_id);

INSERT INTO public.app_settings(key, value, updated_at) VALUES ('derivation_dispatch_controls',
  jsonb_build_object('enabled', true, 'per_run', 20, 'daily_cap', 300,
    'note', 'Stale entity/topic/SEO results after a real clean-text content change are re-queued into the existing runners. Attribution/timestamp-only updates never dispatch. Existing runner budgets apply.'), now())
ON CONFLICT (key) DO NOTHING;

REVOKE EXECUTE ON FUNCTION public.get_episode_index_text(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_episode_index_text(uuid, integer) TO service_role;
COMMENT ON FUNCTION public.get_episode_index_text(uuid, integer) IS 'DEPRECATED for public use 2026-10-24: transcript excerpts must not reach crawler/visitor HTML. Server-only.';
