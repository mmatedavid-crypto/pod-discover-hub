-- production-credit-v1 (owner decision 2026-11-15): a person named in the episode's own text ONLY in an explicit crew
-- role ("Vágó: X", "Szerkesztő: X", "Hangmérnök: X", "Vágók, szerkesztők:\nX") is a production credit: its own
-- category, never a guest / mention / spoken appearance, never counted on public pages, and never proof of absence.
-- Name equality alone is not a mention. Detection: supabase/functions/_shared/person-production-credit.ts; this file
-- re-verifies (source-hash CAS, quotes, residual: no name form left anywhere else in the usable text), audits with
-- full before-state in person_pair_lane_audit and is reversible via undo_person_production_credit_v1. No AI.

-- 1) New terminal disposition value.
ALTER TABLE public.person_pair_dispositions DROP CONSTRAINT IF EXISTS person_pair_dispositions_disposition_check;
ALTER TABLE public.person_pair_dispositions ADD CONSTRAINT person_pair_dispositions_disposition_check CHECK (disposition = ANY (ARRAY[
  'decided_accepted','decided_rejected','first_round_pending','in_progress','technical_retry','source_needed','insufficient_evidence',
  'evidence_pending','human_identity_review','human_contradiction_review','other','resolved_show_host','resolved_feed_credit_not_episode',
  'resolved_production_credit']::text[]));

-- 2) Public readers deny the new mention status exactly like the feed-credit correction (idempotent in-place patch).
DO $$
DECLARE f text; def text; vdef text;
BEGIN
  FOREACH f IN ARRAY ARRAY['person_episodes','get_episode_person_links_v1','get_linkable_episode_people_v1','recompute_person_role_counts'] LOOP
    FOR def IN SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f LOOP
      IF position('resolved_production_credit' IN def) = 0 AND position('''resolved_feed_credit_not_episode''' IN def) > 0 THEN
        EXECUTE replace(def, '''resolved_feed_credit_not_episode''', '''resolved_feed_credit_not_episode'', ''resolved_production_credit''');
      END IF;
    END LOOP;
  END LOOP;
  vdef := pg_get_viewdef('public.person_public_episode_links_v1'::regclass);
  IF position('resolved_production_credit' IN vdef) = 0 THEN
    IF position('''resolved_feed_credit_not_episode''::text' IN vdef) = 0 THEN RAISE EXCEPTION 'person_public_episode_links_v1 shape changed'; END IF;
    EXECUTE 'CREATE OR REPLACE VIEW public.person_public_episode_links_v1 AS ' || rtrim(replace(vdef, '''resolved_feed_credit_not_episode''::text',
      '''resolved_feed_credit_not_episode''::text, ''resolved_production_credit''::text'), '; ');
  END IF;
END $$;

-- 3) Role-label lane treats a production-credit pair as decided.
CREATE OR REPLACE FUNCTION public.person_role_label_block_v1(_person uuid, _episode uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN pe.id IS NULL OR e.id IS NULL THEN 'missing'
    WHEN p.language_decision IS DISTINCT FROM 'accept_hungarian' THEN 'not_hungarian_show'
    WHEN COALESCE(pe.identity_ambiguous,false) OR COALESCE(pe.duplicate_candidate,false) OR COALESCE(pe.needs_human_review_identity,false)
      OR COALESCE(pe.identity_status,'normal') NOT IN ('normal','confirmed','context_resolved')
      OR COALESCE(pe.ai_review_status,'') IN ('needs_human_review','duplicate_candidate')
      OR COALESCE(pe.ai_recommended_action,'') IN ('hide','reject')
      OR COALESCE(pe.activation_status,'') IN ('hidden','rejected')
      -- 'inactive' alone is the default "no page yet" state, not a quality verdict; only a
      -- recorded downgrade reason blocks (otherwise a first explicit credit could never land).
      OR (pe.activation_status = 'inactive' AND COALESCE(NULLIF(pe.activation_reason,''),'below_activation_thresholds')
          NOT IN ('below_activation_thresholds','meets_public_threshold_only')) THEN 'person_identity_flag'
    WHEN EXISTS (SELECT 1 FROM people o WHERE o.normalized_name = pe.normalized_name AND o.id <> pe.id
      AND COALESCE(o.identity_status,'') <> 'merged_into') THEN 'catalog_homonym'
    WHEN COALESCE(pe.is_historical,false) OR (pe.date_of_death IS NOT NULL AND pe.date_of_death < e.published_at::date)
      OR (pe.date_of_birth IS NOT NULL AND pe.date_of_birth < date '1900-01-01') THEN 'historical_person'
    WHEN EXISTS (SELECT 1 FROM person_episode_mentions m WHERE m.person_id = _person AND m.episode_id = _episode
      AND (m.relevance_status IN ('accepted','rejected','in_progress','resolved_show_host','resolved_production_credit') OR COALESCE(m.validation_source,'') ~* 'manual|chatgpt|external_review'
           OR m.ai_identity_match IN ('different_person_same_name','substring_false_positive'))) THEN 'pair_decided_or_conflict'
    WHEN EXISTS (SELECT 1 FROM person_pair_dispositions d WHERE d.person_id = _person AND d.episode_id = _episode
      AND (d.disposition IN ('human_identity_review','human_contradiction_review','decided_rejected','decided_accepted','resolved_show_host','resolved_production_credit') OR d.decided_by LIKE 'human:%')) THEN 'pair_review_state'
    WHEN EXISTS (SELECT 1 FROM person_relevance_work w JOIN person_relevance_batch_jobs j ON j.id = w.claim_token
      WHERE w.person_id = _person AND w.episode_id = _episode AND w.lease_until > now()
        AND j.status IN ('claimed','uploading','submitted','validating','in_progress','finalizing','cancelling','ingesting')) THEN 'open_batch_job'
  END
  FROM (SELECT 1) one
  LEFT JOIN people pe ON pe.id = _person
  LEFT JOIN episodes e ON e.id = _episode
  LEFT JOIN podcasts p ON p.id = e.podcast_id
$function$;

-- 4) Candidates also ship text carrying crew labels; earlier "no label" results are re-checked once (detail.pc1).
CREATE OR REPLACE FUNCTION public.person_role_label_candidates_v1(_after_person uuid, _after_episode uuid, _limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE lim integer := LEAST(GREATEST(COALESCE(_limit, 500), 1), 1000); out jsonb; lp uuid; le uuid; scanned integer;
  lbl constant text := '(vend[eé]g|besz[eé]lget[oő]t[aá]rs|interj[uú]alany|m[uű]sorvezet[oő]|h[aá]zigazd)';
  crew constant text := '(v[aá]g[oó]|v[aá]gta|v[aá]g[aá]s|ut[oó]munka|st[uú]di[oó]munka|szerkeszt|producer|produkci[oó]|hangm[eé]rn[oö]k|hangtechnik|kever[eé]s|mix|master|zene|operat[oő]r|kamera|f[eé]ny|fot[oó]|vide[oó]|vizu[aá]l|grafik|design|bor[ií]t[oó]|d[ií]szlet|smink|rendez|technikus|felv[eé]tel)[[:alpha:]]*[[:space:]]*(:|[–—]|[[:space:]]-[[:space:]])';
BEGIN
  DROP TABLE IF EXISTS pg_temp._rl_keys;
  CREATE TEMP TABLE _rl_keys ON COMMIT DROP AS
    SELECT d.person_id, d.episode_id, d.disposition FROM person_pair_dispositions d
    WHERE (d.person_id, d.episode_id) > (COALESCE(_after_person, '00000000-0000-0000-0000-000000000000'::uuid),
                                         COALESCE(_after_episode, '00000000-0000-0000-0000-000000000000'::uuid))
      AND d.disposition IN ('evidence_pending','first_round_pending','source_needed','technical_retry','in_progress','insufficient_evidence')
    ORDER BY d.person_id, d.episode_id LIMIT lim;
  SELECT count(*) INTO scanned FROM _rl_keys;
  SELECT person_id, episode_id INTO lp, le FROM _rl_keys ORDER BY person_id DESC, episode_id DESC LIMIT 1;
  WITH b AS (
    SELECT k.person_id, k.episode_id, k.disposition, e.podcast_id, pe.name, e.title, e.description, g.page_description, pl.sp_text, pl.yt_text, pl.sig,
      ARRAY(SELECT a.alias FROM person_aliases a WHERE a.person_id = k.person_id AND a.status = 'accepted' AND a.alias ~ '\S\s+\S'
        AND ((a.scope = 'global' AND a.source = 'owner_verified_name_variant_v1') OR (a.scope = 'podcast' AND a.scope_podcast_id = e.podcast_id) OR (a.scope = 'episode' AND a.scope_episode_id = e.id))
        ORDER BY a.alias) aliases
    FROM _rl_keys k JOIN episodes e ON e.id = k.episode_id JOIN people pe ON pe.id = k.person_id
    LEFT JOIN episode_public_page_evidence g ON g.episode_id = e.id AND g.status = 'ok'
    LEFT JOIN LATERAL public.person_role_label_platform_v1(e.id, e.podcast_id, e.published_at) pl ON true
    WHERE k.disposition <> 'insufficient_evidence' OR g.page_description IS NOT NULL OR pl.sp_text IS NOT NULL OR pl.yt_text IS NOT NULL),
  h AS (SELECT b.*, public.person_role_label_source_hash_v1(b.name, b.aliases, b.title, b.description, b.page_description, b.sig) sh,
      concat_ws(' ', b.title, b.description, b.page_description, b.sp_text, b.yt_text) ~* lbl
        OR concat_ws(E'\n', b.title, b.description, b.page_description, b.sp_text, b.yt_text) ~* crew AS any_label FROM b)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'person_id', h.person_id, 'episode_id', h.episode_id, 'podcast_id', h.podcast_id, 'disposition', h.disposition,
      'name', h.name, 'aliases', to_jsonb(h.aliases), 'source_hash', h.sh,
      'has_label', h.any_label,
      'title', h.title,
      'description', CASE WHEN h.any_label THEN left(h.description, 8000) END,
      'page_description', h.page_description,
      'spotify_description', CASE WHEN h.sp_text ~* lbl OR h.sp_text ~* crew THEN left(h.sp_text, 8000) END,
      'youtube_description', CASE WHEN h.yt_text ~* lbl OR h.yt_text ~* crew THEN left(h.yt_text, 8000) END,
      'block', public.person_role_label_block_v1(h.person_id, h.episode_id))), '[]'::jsonb)
  INTO out
  FROM h
  WHERE NOT EXISTS (SELECT 1 FROM person_role_label_results r WHERE r.person_id = h.person_id AND r.episode_id = h.episode_id
    AND r.rule_version = 'role-label-v1' AND r.source_hash = h.sh
    AND (r.outcome NOT IN ('no_label','label_without_name') OR r.detail ? 'pc1'));
  RETURN jsonb_build_object('rows', out, 'scanned', scanned, 'last_person', lp, 'last_episode', le);
END $function$;

-- 5) Apply (CAS + re-verification + full before-state audit).
CREATE OR REPLACE FUNCTION public.apply_person_production_credit_v1(_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE it jsonb; h jsonb; res jsonb := '[]'::jsonb; pid uuid; eid uuid; e record; pe record; pl record; blk text; sh text;
  aliases text[]; page text; ok boolean; t_title text; t_desc text; t_page text; t_sp text; t_yt text; ftxt text; fq text; fs text; fn text;
  mbefore jsonb; dbefore jsonb; ev jsonb; n integer; busy boolean; aud bigint; mid uuid; labels text[];
  crew constant text := '^(fo|felelos |vezeto |zenei |tartalmi )?(vago|vagta|vagas|videovagas|hangvagas|utomunka|studiomunka|szerkeszt|producer|produkcio|hangmernok|hangtechnik|hangkeveres|keveres|mix|master|zene|operator|kamera|feny|foto|video|vizual|grafik|design|borito|diszlet|smink|rendez|technikus|felvetel)';
  speak constant text := '(vendeg|beszelgetotars|interjualany|musorvezeto|hazigazd|riporter|moderator|narrator|meselo|felolvas|szereplo|eloado)';
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb)) LOOP
    pid := (it->>'person_id')::uuid; eid := (it->>'episode_id')::uuid;
    SELECT * INTO e FROM episodes WHERE id = eid;
    SELECT * INTO pe FROM people WHERE id = pid;
    IF e.id IS NULL OR pe.id IS NULL OR jsonb_typeof(it->'hits') IS DISTINCT FROM 'array'
       OR jsonb_array_length(it->'hits') NOT BETWEEN 1 AND 20 THEN
      res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'invalid_item'); CONTINUE;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('person_pair:' || pid::text || ':' || eid::text));
    busy := false;
    BEGIN
      PERFORM 1 FROM person_pair_dispositions d WHERE d.person_id = pid AND d.episode_id = eid FOR UPDATE NOWAIT;
      PERFORM 1 FROM person_episode_mentions m WHERE m.person_id = pid AND m.episode_id = eid FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN busy := true;
    END;
    IF busy THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'busy_retry'); CONTINUE; END IF;
    blk := public.person_role_label_block_v1(pid, eid);
    IF blk IS NOT NULL THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'blocked_' || blk); CONTINUE; END IF;
    aliases := ARRAY(SELECT a.alias FROM person_aliases a WHERE a.person_id = pid AND a.status = 'accepted' AND a.alias ~ '\S\s+\S'
        AND ((a.scope = 'global' AND a.source = 'owner_verified_name_variant_v1') OR (a.scope = 'podcast' AND a.scope_podcast_id = e.podcast_id) OR (a.scope = 'episode' AND a.scope_episode_id = e.id)) ORDER BY a.alias);
    page := NULL;
    SELECT g.page_description INTO page FROM episode_public_page_evidence g WHERE g.episode_id = eid AND g.status = 'ok';
    SELECT * INTO pl FROM public.person_role_label_platform_v1(e.id, e.podcast_id, e.published_at);
    sh := public.person_role_label_source_hash_v1(pe.name, aliases, e.title, e.description, page, pl.sig);
    IF sh IS DISTINCT FROM it->>'source_hash' THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'source_changed'); CONTINUE; END IF;
    t_title := public.person_text_fold_v1(e.title); t_desc := public.person_text_fold_v1(e.description); t_page := public.person_text_fold_v1(page);
    t_sp := public.person_text_fold_v1(pl.sp_text); t_yt := public.person_text_fold_v1(pl.yt_text);
    ok := true; labels := '{}';
    FOR h IN SELECT * FROM jsonb_array_elements(it->'hits') LOOP
      ftxt := CASE h->>'field' WHEN 'episode_title' THEN t_title WHEN 'episode_description' THEN t_desc WHEN 'episode_page' THEN t_page
        WHEN 'spotify_episode_description' THEN t_sp WHEN 'youtube_episode_description' THEN t_yt END;
      fq := public.person_text_fold_v1(h->>'quote'); fs := public.person_text_fold_v1(h->>'snippet'); fn := public.person_text_fold_v1(h->>'matched_name');
      IF COALESCE(ftxt,'') = '' OR fq = '' OR fs = '' OR fn = '' OR position(fq IN ftxt) = 0 OR position(fs IN fq) = 0 OR position(fn IN fs) = 0
         OR fs !~ crew OR split_part(fs, fn, 1) ~ speak
         OR (NOT EXISTS (SELECT 1 FROM public.person_name_forms_hu_v1(pe.name) f WHERE f.form = fn)
             AND NOT EXISTS (SELECT 1 FROM unnest(aliases) a CROSS JOIN LATERAL public.person_name_forms_hu_v1(a) f WHERE f.form = fn)) THEN
        ok := false; EXIT;
      END IF;
      CASE h->>'field'
        WHEN 'episode_title' THEN t_title := replace(t_title, fs, ' | ');
        WHEN 'episode_description' THEN t_desc := replace(t_desc, fs, ' | ');
        WHEN 'episode_page' THEN t_page := replace(t_page, fs, ' | ');
        WHEN 'spotify_episode_description' THEN t_sp := replace(t_sp, fs, ' | ');
        ELSE t_yt := replace(t_yt, fs, ' | ');
      END CASE;
      labels := labels || btrim(split_part(fs, ':', 1));
    END LOOP;
    IF NOT ok THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'quote_verify_failed'); CONTINUE; END IF;
    -- Residual: the person's name (or a scoped alias) must not occur anywhere else in the usable episode text.
    IF EXISTS (SELECT 1 FROM unnest(array_prepend(pe.name, aliases)) a
               WHERE length(public.person_text_fold_v1(a)) > 3
                 AND position(public.person_text_fold_v1(a) IN concat_ws(' | ', t_title, t_desc, t_page, t_sp, t_yt)) > 0) THEN
      res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'name_outside_credit'); CONTINUE;
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO mbefore FROM person_episode_mentions m WHERE m.person_id = pid AND m.episode_id = eid;
    SELECT to_jsonb(d) INTO dbefore FROM person_pair_dispositions d WHERE d.person_id = pid AND d.episode_id = eid;
    ev := jsonb_build_object('rule', 'production-credit-v1', 'labels', to_jsonb(labels), 'hits', it->'hits', 'source_hash', sh, 'applied_at', now());
    UPDATE person_episode_mentions m SET relevance_status = 'resolved_production_credit', role_type = 'production_credit',
      validation_source = 'deterministic_production_credit_v1',
      role_reason = 'Az epizód saját szövege kizárólag stábszerepben nevezi meg (' || left(array_to_string(labels, '; '), 200)
        || '). Produkciós kredit: nem vendég, nem említés, nem megszólalás.',
      source_evidence = COALESCE(m.source_evidence, '{}'::jsonb) || jsonb_build_object('production_credit_v1', ev)
    WHERE m.person_id = pid AND m.episode_id = eid AND m.relevance_status IN ('pending','needs_review','waiting_clean_text')
      AND COALESCE(m.validation_source,'') !~* 'manual|chatgpt|external_review';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'mention_state_changed'); CONTINUE; END IF;
    SELECT m.id INTO mid FROM person_episode_mentions m WHERE m.person_id = pid AND m.episode_id = eid
      AND m.validation_source = 'deterministic_production_credit_v1' ORDER BY m.id LIMIT 1;
    INSERT INTO person_pair_dispositions AS d (person_id, episode_id, disposition, reason_code, policy_version, decided_by, detail, reopen_on_source_change)
    VALUES (pid, eid, 'resolved_production_credit', 'explicit_production_credit', 'production-credit-v1', 'deterministic:production-credit-v1',
      jsonb_build_object('production_credit', to_jsonb(labels)), false)
    ON CONFLICT (person_id, episode_id) DO UPDATE SET disposition = EXCLUDED.disposition, reason_code = EXCLUDED.reason_code,
      policy_version = EXCLUDED.policy_version, decided_by = EXCLUDED.decided_by, detail = COALESCE(d.detail, '{}'::jsonb) || EXCLUDED.detail,
      reopen_on_source_change = false, updated_at = now()
    WHERE COALESCE(d.decided_by,'') NOT LIKE 'human:%';
    UPDATE person_relevance_work w SET lease_until = now(), updated_at = now()
    WHERE w.person_id = pid AND w.episode_id = eid AND w.lease_until > now()
      AND NOT EXISTS (SELECT 1 FROM person_relevance_batch_jobs j WHERE j.id = w.claim_token);
    INSERT INTO person_pair_lane_audit (lane, action, person_id, episode_id, mention_id, rule_version, before_state, after_state, evidence)
    VALUES ('production_credit', 'resolve', pid, eid, mid, 'production-credit-v1', jsonb_build_object('mentions', mbefore, 'disposition', dbefore),
      jsonb_build_object('relevance_status', 'resolved_production_credit', 'role_type', 'production_credit', 'mentions_updated', n), ev)
    RETURNING id INTO aud;
    res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'production_credit_applied', 'audit_id', aud, 'labels', to_jsonb(labels));
  END LOOP;
  RETURN res;
END $function$;

-- 6) Undo restores every mention row and the disposition from the audited before-state.
CREATE OR REPLACE FUNCTION public.undo_person_production_credit_v1(_audit_ids bigint[], _all boolean DEFAULT false, _by text DEFAULT 'service')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a record; m jsonb; d jsonb; n integer := 0;
BEGIN
  IF _audit_ids IS NULL AND NOT _all THEN RAISE EXCEPTION 'specify audit ids or _all'; END IF;
  PERFORM set_config('podiverzum.production_credit_undo', 'on', true);
  FOR a IN SELECT * FROM person_pair_lane_audit WHERE lane = 'production_credit' AND action = 'resolve' AND undone_at IS NULL
    AND (_all OR id = ANY(_audit_ids)) ORDER BY id DESC LOOP
    FOR m IN SELECT * FROM jsonb_array_elements(COALESCE(a.before_state->'mentions', '[]'::jsonb)) LOOP
      UPDATE person_episode_mentions SET relevance_status = m->>'relevance_status', role_type = m->>'role_type',
        validation_source = m->>'validation_source', role_reason = m->>'role_reason',
        source_evidence = COALESCE(NULLIF(m->'source_evidence', 'null'::jsonb), '{}'::jsonb)
      WHERE id = (m->>'id')::uuid AND validation_source = 'deterministic_production_credit_v1';
    END LOOP;
    d := a.before_state->'disposition';
    IF d IS NOT NULL AND jsonb_typeof(d) = 'object' THEN
      UPDATE person_pair_dispositions SET disposition = d->>'disposition', reason_code = d->>'reason_code', decided_by = d->>'decided_by',
        policy_version = d->>'policy_version', detail = COALESCE(d->'detail', '{}'::jsonb),
        reopen_on_source_change = COALESCE((d->>'reopen_on_source_change')::boolean, reopen_on_source_change), updated_at = now()
      WHERE person_id = a.person_id AND episode_id = a.episode_id AND decided_by = 'deterministic:production-credit-v1';
    END IF;
    UPDATE person_pair_lane_audit SET undone_at = now(), undone_by = left(_by, 120) WHERE id = a.id;
    INSERT INTO person_pair_lane_audit (lane, action, person_id, episode_id, mention_id, rule_version, before_state, after_state, evidence)
    VALUES ('production_credit', 'undo', a.person_id, a.episode_id, a.mention_id, a.rule_version, a.after_state, a.before_state, jsonb_build_object('undo_of', a.id, 'by', _by));
    UPDATE person_role_label_results SET outcome = 'undone', checked_at = now()
    WHERE person_id = a.person_id AND episode_id = a.episode_id AND rule_version = 'role-label-v1';
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('undone', n);
END $function$;

-- 7) Keep the credit: a re-import cannot flip it back to pending, and a new pending row for the pair inherits it.
CREATE OR REPLACE FUNCTION public.protect_production_credit_mention_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('podiverzum.production_credit_undo', true) = 'on' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.validation_source,'') ~* 'manual|chatgpt|external_review' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.validation_source = 'deterministic_production_credit_v1' AND NEW.relevance_status IN ('pending','needs_review','waiting_clean_text') THEN
      NEW.relevance_status := OLD.relevance_status; NEW.role_type := OLD.role_type; NEW.validation_source := OLD.validation_source;
      NEW.role_reason := OLD.role_reason; NEW.source_evidence := OLD.source_evidence;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.relevance_status NOT IN ('pending','needs_review','waiting_clean_text') THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM person_pair_dispositions d WHERE d.person_id = NEW.person_id AND d.episode_id = NEW.episode_id
             AND d.disposition = 'resolved_production_credit' AND d.decided_by = 'deterministic:production-credit-v1') THEN
    NEW.relevance_status := 'resolved_production_credit'; NEW.role_type := 'production_credit';
    NEW.validation_source := 'deterministic_production_credit_v1';
    NEW.role_reason := 'A pár stábkreditként lezárva (production-credit-v1); nem vendég, nem említés, nem megszólalás.';
    NEW.source_evidence := COALESCE(NEW.source_evidence, '{}'::jsonb) || jsonb_build_object('production_credit_v1_inherited', true);
  END IF;
  RETURN NEW;
END $function$;
-- "z_" fires after the host-rule / episode-credit triggers, so those stronger rules win on new rows.
CREATE OR REPLACE TRIGGER z_protect_production_credit_mention BEFORE INSERT OR UPDATE ON public.person_episode_mentions
  FOR EACH ROW EXECUTE FUNCTION public.protect_production_credit_mention_v1();

-- 8) Service role only.
REVOKE ALL ON FUNCTION public.apply_person_production_credit_v1(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.undo_person_production_credit_v1(bigint[], boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_production_credit_mention_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.person_role_label_candidates_v1(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.person_role_label_block_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_person_production_credit_v1(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.undo_person_production_credit_v1(bigint[], boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.person_role_label_candidates_v1(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.person_role_label_block_v1(uuid, uuid) TO service_role;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
  EXECUTE 'REVOKE ALL ON FUNCTION public.apply_person_production_credit_v1(jsonb) FROM readonly_codex';
  EXECUTE 'REVOKE ALL ON FUNCTION public.undo_person_production_credit_v1(bigint[], boolean, text) FROM readonly_codex';
END IF; END $$;