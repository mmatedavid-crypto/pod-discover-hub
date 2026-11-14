CREATE OR REPLACE FUNCTION public.apply_person_role_label_v1(_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s' AS $$
DECLARE it jsonb; res jsonb := '[]'::jsonb; pid uuid; eid uuid; e record; pe record; blk text; anc jsonb; fld text; ftxt text;
  q text; fq text; nm text; role text; sh text; aliases text[]; page text; snip text; total_eps integer; rep integer; descr text;
  mrow record; mid uuid; inserted boolean; aud bigint; ev jsonb; before jsonb; dbefore jsonb;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb)) LOOP
    anc := NULL; rep := NULL; total_eps := NULL; page := NULL;
    pid := (it->>'person_id')::uuid; eid := (it->>'episode_id')::uuid;
    role := it->>'role'; fld := it->>'field'; q := it->>'quote'; nm := it->>'matched_name'; snip := it->>'snippet';
    descr := COALESCE(it->>'descriptor', '');
    SELECT * INTO e FROM episodes WHERE id = eid;
    SELECT * INTO pe FROM people WHERE id = pid;
    IF e.id IS NULL OR pe.id IS NULL OR role NOT IN ('guest','host') OR fld NOT IN ('episode_title','episode_description','episode_page')
       OR COALESCE(q,'') = '' OR COALESCE(nm,'') = '' OR COALESCE(snip,'') = '' THEN
      res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'invalid_item'); CONTINUE;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('person_pair:' || pid::text || ':' || eid::text));
    blk := public.person_role_label_block_v1(pid, eid);
    IF blk IS NOT NULL THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'blocked_' || blk); CONTINUE; END IF;
    aliases := ARRAY(SELECT a.alias FROM person_aliases a WHERE a.person_id = pid AND a.status = 'accepted' AND a.alias ~ '\S\s+\S'
        AND ((a.scope = 'podcast' AND a.scope_podcast_id = e.podcast_id) OR (a.scope = 'episode' AND a.scope_episode_id = e.id)) ORDER BY a.alias);
    SELECT g.page_description INTO page FROM episode_public_page_evidence g WHERE g.episode_id = eid AND g.status = 'ok';
    sh := public.person_role_label_source_hash_v1(pe.name, aliases, e.title, e.description, page);
    IF sh IS DISTINCT FROM it->>'source_hash' THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'source_changed'); CONTINUE; END IF;
    IF public.person_text_fold_v1(nm) <> public.person_text_fold_v1(pe.name)
       AND NOT EXISTS (SELECT 1 FROM unnest(aliases) a WHERE public.person_text_fold_v1(a) = public.person_text_fold_v1(nm)) THEN
      res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'name_not_person'); CONTINUE;
    END IF;
    ftxt := public.person_text_fold_v1(CASE fld WHEN 'episode_title' THEN e.title WHEN 'episode_description' THEN e.description ELSE page END);
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
      SELECT count(*) FILTER (WHERE x.description IS NOT NULL),
             count(*) FILTER (WHERE x.id <> eid AND position(public.person_text_fold_v1(snip) IN public.person_text_fold_v1(x.description)) > 0)
        INTO total_eps, rep FROM (SELECT y.id, y.description FROM episodes y WHERE y.podcast_id = e.podcast_id
          ORDER BY y.published_at DESC NULLS LAST LIMIT 400) x;
      IF rep >= 3 AND rep::numeric >= 0.2 * GREATEST(total_eps, 1) THEN
        res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'series_footer_credit', 'repeat_episodes', rep, 'show_episodes', total_eps);
        CONTINUE;
      END IF;
    END IF;
    ev := jsonb_build_object('rule', 'role-label-v1', 'role', role, 'field', fld, 'quote', left(q, 400), 'label_snippet', left(snip, 200),
      'descriptor', NULLIF(descr, ''), 'matched_name', nm, 'source_hash', sh, 'identity', anc, 'repeat_episodes', COALESCE(rep, 0), 'applied_at', now());
    SELECT * INTO mrow FROM person_episode_mentions m WHERE m.person_id = pid AND m.episode_id = eid AND m.mention_type = role LIMIT 1;
    inserted := mrow.id IS NULL;
    SELECT to_jsonb(d) INTO dbefore FROM person_pair_dispositions d WHERE d.person_id = pid AND d.episode_id = eid;
    IF inserted THEN
      INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, confidence, evidence, source, relevance_status,
        final_relevance_score, validation_source, role_type, role_confidence, role_reason, source_evidence)
      VALUES (pid, eid, e.podcast_id, role, 0.99, left(q, 500), 'role_label_v1', 'accepted', 0.99, 'deterministic_role_label_v1',
        'participant', 0.99, 'Az epizód saját leírása szerepcímkével nevezi meg (' || role || ').', jsonb_build_object('role_label_v1', ev))
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
        role_type = 'participant', role_confidence = 0.99, role_reason = 'Az epizód saját leírása szerepcímkével nevezi meg (' || role || ').',
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
END $$;
REVOKE ALL ON FUNCTION public.apply_person_role_label_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_person_role_label_v1(jsonb) TO service_role;