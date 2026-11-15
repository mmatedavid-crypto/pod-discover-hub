-- Owner one-off (2026-11-15): matched Spotify / confirmed YouTube episode descriptions feed the existing role-label lane.
-- Same eligibility predicates as person_evidence_source_v1; deterministic pick; real source id/url/hash kept.
CREATE OR REPLACE FUNCTION public.person_role_label_platform_v1(_episode uuid, _podcast uuid, _published timestamptz)
 RETURNS TABLE(sp_text text, sp_src jsonb, yt_text text, yt_src jsonb, sig text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH sp AS (
    SELECT s.spotify_description t, jsonb_build_object('platform', 'Spotify', 'source_type', 'spotify_episode_description', 'source_id', s.id,
        'spotify_episode_id', s.spotify_episode_id, 'source_url', s.spotify_url, 'content_md5', md5(s.spotify_description), 'match_confidence', s.match_confidence) j
    FROM episode_spotify_meta s
    WHERE s.episode_id = _episode AND s.podcast_id = _podcast AND s.match_confidence >= 0.8 AND s.release_date = _published::date
      AND length(s.spotify_description) > 0
    ORDER BY s.match_confidence DESC, s.id LIMIT 1),
  yt AS (
    SELECT y.youtube_description t, jsonb_build_object('platform', 'YouTube', 'source_type', 'youtube_episode_description', 'source_id', y.id,
        'youtube_video_id', y.youtube_video_id, 'source_url', 'https://www.youtube.com/watch?v=' || y.youtube_video_id,
        'content_md5', md5(y.youtube_description), 'match_score', y.match_score) j
    FROM episode_youtube_links y
    WHERE y.episode_id = _episode AND y.podcast_id = _podcast AND y.status = 'confirmed' AND y.match_score >= 0.84
      AND length(y.youtube_description) > 0
    ORDER BY y.match_score DESC, y.youtube_video_id LIMIT 1)
  SELECT (SELECT t FROM sp), (SELECT j FROM sp), (SELECT t FROM yt), (SELECT j FROM yt),
    CASE WHEN EXISTS (SELECT 1 FROM sp) OR EXISTS (SELECT 1 FROM yt) THEN concat_ws('|',
      (SELECT 'sp:' || (j->>'source_id') || ':' || (j->>'content_md5') FROM sp), (SELECT 'yt:' || (j->>'source_id') || ':' || (j->>'content_md5') FROM yt)) END
$function$;

-- Hash over the actual eligible input (content + source identity, no timestamps). Without platform text it equals the
-- old 5-argument hash, so already processed unchanged pairs stay skipped.
CREATE OR REPLACE FUNCTION public.person_role_label_source_hash_v1(_name text, _aliases text[], _title text, _description text, _page text, _platform_sig text)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE WHEN _platform_sig IS NULL THEN public.person_role_label_source_hash_v1(_name, _aliases, _title, _description, _page)
    ELSE md5(concat_ws('|', public.person_role_label_source_hash_v1(_name, _aliases, _title, _description, _page), 'platform-v1', _platform_sig)) END
$function$;

CREATE OR REPLACE FUNCTION public.person_role_label_candidates_v1(_after_person uuid, _after_episode uuid, _limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE lim integer := LEAST(GREATEST(COALESCE(_limit, 500), 1), 1000); out jsonb; lp uuid; le uuid; scanned integer;
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
  h AS (SELECT b.*, public.person_role_label_source_hash_v1(b.name, b.aliases, b.title, b.description, b.page_description, b.sig) sh FROM b)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'person_id', h.person_id, 'episode_id', h.episode_id, 'podcast_id', h.podcast_id, 'disposition', h.disposition,
      'name', h.name, 'aliases', to_jsonb(h.aliases), 'source_hash', h.sh,
      'has_label', concat_ws(' ', h.title, h.description, h.page_description, h.sp_text, h.yt_text) ~* '(vend[eé]g|besz[eé]lget[oő]t[aá]rs|interj[uú]alany|m[uű]sorvezet[oő]|h[aá]zigazd)',
      'title', h.title,
      'description', CASE WHEN concat_ws(' ', h.title, h.description, h.page_description, h.sp_text, h.yt_text) ~* '(vend[eé]g|besz[eé]lget[oő]t[aá]rs|interj[uú]alany|m[uű]sorvezet[oő]|h[aá]zigazd)' THEN left(h.description, 8000) END,
      'page_description', h.page_description,
      'spotify_description', CASE WHEN h.sp_text ~* '(vend[eé]g|besz[eé]lget[oő]t[aá]rs|interj[uú]alany|m[uű]sorvezet[oő]|h[aá]zigazd)' THEN left(h.sp_text, 8000) END,
      'youtube_description', CASE WHEN h.yt_text ~* '(vend[eé]g|besz[eé]lget[oő]t[aá]rs|interj[uú]alany|m[uű]sorvezet[oő]|h[aá]zigazd)' THEN left(h.yt_text, 8000) END,
      'block', public.person_role_label_block_v1(h.person_id, h.episode_id))), '[]'::jsonb)
  INTO out
  FROM h
  WHERE NOT EXISTS (SELECT 1 FROM person_role_label_results r WHERE r.person_id = h.person_id AND r.episode_id = h.episode_id
    AND r.rule_version = 'role-label-v1' AND r.source_hash = h.sh);
  RETURN jsonb_build_object('rows', out, 'scanned', scanned, 'last_person', lp, 'last_episode', le);
END $function$;

CREATE OR REPLACE FUNCTION public.apply_person_role_label_v1(_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE it jsonb; res jsonb := '[]'::jsonb; pid uuid; eid uuid; e record; pe record; blk text; anc jsonb; fld text; ftxt text;
  q text; fq text; nm text; role text; sh text; aliases text[]; page text; snip text; total_eps integer; rep integer; descr text;
  mrow record; pl record; src jsonb; mid uuid; inserted boolean; busy boolean; aud bigint; ev jsonb; before jsonb; dbefore jsonb;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb)) LOOP
    anc := NULL; rep := NULL; total_eps := NULL; page := NULL; src := NULL;
    pid := (it->>'person_id')::uuid; eid := (it->>'episode_id')::uuid;
    role := it->>'role'; fld := it->>'field'; q := it->>'quote'; nm := it->>'matched_name'; snip := it->>'snippet';
    descr := COALESCE(it->>'descriptor', '');
    SELECT * INTO e FROM episodes WHERE id = eid;
    SELECT * INTO pe FROM people WHERE id = pid;
    IF e.id IS NULL OR pe.id IS NULL OR role NOT IN ('guest','host') OR fld NOT IN ('episode_title','episode_description','episode_page','spotify_episode_description','youtube_episode_description')
       OR COALESCE(q,'') = '' OR COALESCE(nm,'') = '' OR COALESCE(snip,'') = '' THEN
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
    SELECT g.page_description INTO page FROM episode_public_page_evidence g WHERE g.episode_id = eid AND g.status = 'ok';
    SELECT * INTO pl FROM public.person_role_label_platform_v1(e.id, e.podcast_id, e.published_at);
    sh := public.person_role_label_source_hash_v1(pe.name, aliases, e.title, e.description, page, pl.sig);
    IF sh IS DISTINCT FROM it->>'source_hash' THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'source_changed'); CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.person_name_forms_hu_v1(pe.name) f WHERE f.form=public.person_text_fold_v1(nm))
       AND NOT EXISTS (SELECT 1 FROM unnest(aliases) a CROSS JOIN LATERAL public.person_name_forms_hu_v1(a) f WHERE f.form=public.person_text_fold_v1(nm)) THEN
      res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'name_not_person'); CONTINUE;
    END IF;
    IF fld = 'spotify_episode_description' THEN src := pl.sp_src; ELSIF fld = 'youtube_episode_description' THEN src := pl.yt_src; END IF;
    ftxt := public.person_text_fold_v1(CASE fld WHEN 'episode_title' THEN e.title WHEN 'episode_description' THEN e.description
      WHEN 'spotify_episode_description' THEN pl.sp_text WHEN 'youtube_episode_description' THEN pl.yt_text ELSE page END);
    IF ftxt IS NULL THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'quote_verify_failed'); CONTINUE; END IF;
    fq := public.person_text_fold_v1(q);
    IF position(fq IN ftxt) = 0 OR position(public.person_text_fold_v1(snip) IN fq) = 0
       OR position(public.person_text_fold_v1(nm) IN public.person_text_fold_v1(snip)) = 0
       OR public.person_text_fold_v1(snip) !~ '(vendeg|beszelgetotars|interjualany|musorvezeto|hazigazd)'
       OR (descr <> '' AND position(public.person_text_fold_v1(descr) IN fq) = 0) THEN
      res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'quote_verify_failed'); CONTINUE;
    END IF;
    anc := public.person_role_label_anchor_v1(pid, e.podcast_id, NULLIF(descr, ''));
    IF anc IS NULL THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'identity_unanchored'); CONTINUE; END IF;
    IF fld <> 'episode_title' THEN
      -- Repeated-footer check runs on the same source type the hit came from (RSS / Spotify / YouTube).
      SELECT count(*) FILTER (WHERE x.description IS NOT NULL),
             count(*) FILTER (WHERE x.id <> eid AND position(public.person_text_fold_v1(snip) IN public.person_text_fold_v1(x.description)) > 0)
        INTO total_eps, rep FROM (
          SELECT y.id, y.description, y.published_at FROM episodes y
            WHERE fld NOT IN ('spotify_episode_description','youtube_episode_description') AND y.podcast_id = e.podcast_id
          UNION ALL
          SELECT s.episode_id, NULLIF(s.spotify_description, ''), s.release_date::timestamptz FROM episode_spotify_meta s
            WHERE fld = 'spotify_episode_description' AND s.podcast_id = e.podcast_id
          UNION ALL
          SELECT z.episode_id, z.d, ep.published_at FROM (SELECT DISTINCT ON (y.episode_id) y.episode_id, NULLIF(y.youtube_description, '') d
              FROM episode_youtube_links y WHERE fld = 'youtube_episode_description' AND y.podcast_id = e.podcast_id AND y.status = 'confirmed'
              ORDER BY y.episode_id, y.match_score DESC NULLS LAST, y.youtube_video_id) z JOIN episodes ep ON ep.id = z.episode_id
          ORDER BY 3 DESC NULLS LAST LIMIT 400) x;
      IF rep >= 3 AND rep::numeric >= 0.2 * GREATEST(total_eps, 1) THEN
        res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'series_footer_credit', 'repeat_episodes', rep, 'show_episodes', total_eps);
        CONTINUE;
      END IF;
    END IF;
    ev := jsonb_build_object('rule', 'role-label-v1', 'role', role, 'field', fld, 'quote', left(q, 400), 'label_snippet', left(snip, 200),
      'descriptor', NULLIF(descr, ''), 'matched_name', nm, 'source_hash', sh, 'source', src, 'identity', anc, 'repeat_episodes', COALESCE(rep, 0), 'applied_at', now());
    SELECT * INTO mrow FROM person_episode_mentions m WHERE m.person_id = pid AND m.episode_id = eid AND m.mention_type = role LIMIT 1;
    inserted := mrow.id IS NULL;
    SELECT to_jsonb(d) INTO dbefore FROM person_pair_dispositions d WHERE d.person_id = pid AND d.episode_id = eid;
    IF inserted THEN
      INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, confidence, evidence, source, relevance_status,
        final_relevance_score, validation_source, role_type, role_confidence, role_reason, source_evidence)
      VALUES (pid, eid, e.podcast_id, role, 0.99, left(q, 500), 'role_label_v1', 'accepted', 0.99, 'deterministic_role_label_v1',
        'participant', 0.99, CASE WHEN src IS NULL THEN 'Az epizód saját leírása' ELSE 'Az epizód ' || (src->>'platform') || '-leírása' END || ' szerepcímkével nevezi meg (' || role || ').', jsonb_build_object('role_label_v1', ev))
      RETURNING id INTO mid;
      before := jsonb_build_object('inserted', true);
    ELSE
      IF mrow.relevance_status NOT IN ('pending','needs_review') THEN
        res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'mention_state_changed'); CONTINUE;
      END IF;
      before := jsonb_build_object('inserted', false, 'relevance_status', mrow.relevance_status, 'validation_source', mrow.validation_source,
        'final_relevance_score', mrow.final_relevance_score, 'role_type', mrow.role_type, 'role_confidence', mrow.role_confidence,
        'role_reason', mrow.role_reason, 'source_evidence', mrow.source_evidence);
      UPDATE person_episode_mentions SET relevance_status = 'accepted', validation_source = 'deterministic_role_label_v1', final_relevance_score = 0.99,
        role_type = 'participant', role_confidence = 0.99, role_reason = CASE WHEN src IS NULL THEN 'Az epizód saját leírása' ELSE 'Az epizód ' || (src->>'platform') || '-leírása' END || ' szerepcímkével nevezi meg (' || role || ').',
        source_evidence = COALESCE(source_evidence, '{}'::jsonb) || jsonb_build_object('role_label_v1', ev)
      WHERE id = mrow.id AND relevance_status = mrow.relevance_status
        AND COALESCE(validation_source,'') !~* 'manual|chatgpt|external_review';
      IF NOT FOUND THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'mention_state_changed'); CONTINUE; END IF;
      mid := mrow.id;
    END IF;
    UPDATE person_pair_dispositions SET disposition = 'decided_accepted', reason_code = 'accepted_link', decided_by = 'deterministic:role-label-v1',
      policy_version = 'role-label-v1', detail = detail || jsonb_build_object('role_label', ev->'identity'->>'anchor'), updated_at = now()
    WHERE person_id = pid AND episode_id = eid AND decided_by NOT LIKE 'human:%';
    UPDATE person_relevance_work w SET lease_until = now(), updated_at = now()
    WHERE w.person_id = pid AND w.episode_id = eid AND w.lease_until > now()
      AND NOT EXISTS (SELECT 1 FROM person_relevance_batch_jobs j WHERE j.id = w.claim_token);
    INSERT INTO person_pair_lane_audit (lane, action, person_id, episode_id, mention_id, rule_version, before_state, after_state, evidence)
    VALUES ('role_label', 'accept', pid, eid, mid, 'role-label-v1', before || jsonb_build_object('disposition', dbefore),
      jsonb_build_object('relevance_status', 'accepted', 'mention_type', role, 'validation_source', 'deterministic_role_label_v1'), ev)
    RETURNING id INTO aud;
    res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'applied', 'audit_id', aud, 'anchor', anc->>'anchor', 'role', role);
  END LOOP;
  RETURN res;
END $function$;

REVOKE ALL ON FUNCTION public.person_role_label_platform_v1(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.person_role_label_source_hash_v1(text, text[], text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.person_role_label_candidates_v1(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_person_role_label_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.person_role_label_platform_v1(uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.person_role_label_source_hash_v1(text, text[], text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.person_role_label_candidates_v1(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_person_role_label_v1(jsonb) TO service_role;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
  EXECUTE 'REVOKE ALL ON FUNCTION public.person_role_label_platform_v1(uuid, uuid, timestamptz) FROM readonly_codex';
  EXECUTE 'REVOKE ALL ON FUNCTION public.apply_person_role_label_v1(jsonb) FROM readonly_codex';
END IF; END $$;