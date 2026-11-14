-- Person pipeline v5 (part 2): role-label lane, page evidence targets, classifier v5.

CREATE OR REPLACE FUNCTION public.person_role_label_candidates_v1(_after_person uuid, _after_episode uuid, _limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '60s' AS $$
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
    SELECT k.person_id, k.episode_id, k.disposition, e.podcast_id, pe.name, e.title, e.description, g.page_description,
      ARRAY(SELECT a.alias FROM person_aliases a WHERE a.person_id = k.person_id AND a.status = 'accepted' AND a.alias ~ '\S\s+\S'
        AND ((a.scope = 'podcast' AND a.scope_podcast_id = e.podcast_id) OR (a.scope = 'episode' AND a.scope_episode_id = e.id))
        ORDER BY a.alias) aliases
    FROM _rl_keys k JOIN episodes e ON e.id = k.episode_id JOIN people pe ON pe.id = k.person_id
    LEFT JOIN episode_public_page_evidence g ON g.episode_id = e.id AND g.status = 'ok'
    WHERE k.disposition <> 'insufficient_evidence' OR g.page_description IS NOT NULL),
  h AS (SELECT b.*, public.person_role_label_source_hash_v1(b.name, b.aliases, b.title, b.description, b.page_description) sh FROM b)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'person_id', h.person_id, 'episode_id', h.episode_id, 'podcast_id', h.podcast_id, 'disposition', h.disposition,
      'name', h.name, 'aliases', to_jsonb(h.aliases), 'source_hash', h.sh,
      'has_label', concat_ws(' ', h.title, h.description, h.page_description) ~* '(vend[eé]g|besz[eé]lget[oő]t[aá]rs|interj[uú]alany|m[uű]sorvezet[oő]|h[aá]zigazd)',
      'title', h.title,
      'description', CASE WHEN concat_ws(' ', h.title, h.description, h.page_description) ~* '(vend[eé]g|besz[eé]lget[oő]t[aá]rs|interj[uú]alany|m[uű]sorvezet[oő]|h[aá]zigazd)' THEN left(h.description, 8000) END,
      'page_description', h.page_description,
      'block', public.person_role_label_block_v1(h.person_id, h.episode_id))), '[]'::jsonb)
  INTO out
  FROM h
  WHERE NOT EXISTS (SELECT 1 FROM person_role_label_results r WHERE r.person_id = h.person_id AND r.episode_id = h.episode_id
    AND r.rule_version = 'role-label-v1' AND r.source_hash = h.sh);
  RETURN jsonb_build_object('rows', out, 'scanned', scanned, 'last_person', lp, 'last_episode', le);
END $$;

CREATE OR REPLACE FUNCTION public.record_person_role_label_results_v1(_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n integer;
BEGIN
  INSERT INTO person_role_label_results AS r (person_id, episode_id, rule_version, source_hash, outcome, detail, checked_at)
  SELECT (x->>'person_id')::uuid, (x->>'episode_id')::uuid, 'role-label-v1', x->>'source_hash', left(x->>'outcome', 60),
         COALESCE(x->'detail', '{}'::jsonb), now()
  FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb)) x
  WHERE x->>'person_id' IS NOT NULL AND x->>'episode_id' IS NOT NULL AND x->>'source_hash' IS NOT NULL AND x->>'outcome' IS NOT NULL
  ON CONFLICT (person_id, episode_id, rule_version) DO UPDATE SET source_hash = EXCLUDED.source_hash, outcome = EXCLUDED.outcome,
    detail = EXCLUDED.detail, checked_at = now()
  WHERE r.outcome NOT IN ('applied','undone') OR (r.source_hash IS DISTINCT FROM EXCLUDED.source_hash);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.apply_person_role_label_v1(_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s' AS $$
DECLARE it jsonb; res jsonb := '[]'::jsonb; pid uuid; eid uuid; e record; pe record; blk text; anc jsonb; fld text; ftxt text;
  q text; fq text; nm text; role text; sh text; aliases text[]; page text; snip text; total_eps integer; rep integer;
  mrow record; mid uuid; inserted boolean; aud bigint; ev jsonb; before jsonb; dbefore jsonb; outcome text;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb)) LOOP
    outcome := NULL; anc := NULL; rep := NULL; total_eps := NULL; page := NULL;
    pid := (it->>'person_id')::uuid; eid := (it->>'episode_id')::uuid;
    role := it->>'role'; fld := it->>'field'; q := it->>'quote'; nm := it->>'matched_name'; snip := it->>'snippet';
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
       OR public.person_text_fold_v1(snip) !~ '(vendeg|beszelgetotars|interjualany|musorvezeto|hazigazd)' THEN
      res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'quote_verify_failed'); CONTINUE;
    END IF;
    anc := public.person_role_label_anchor_v1(pid, e.podcast_id, q);
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
      'matched_name', nm, 'source_hash', sh, 'identity', anc, 'repeat_episodes', COALESCE(rep, 0), 'applied_at', now());
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

CREATE OR REPLACE FUNCTION public.undo_person_role_label_v1(_audit_ids bigint[], _all boolean DEFAULT false, _by text DEFAULT 'service')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a record; n integer := 0; skipped integer := 0; d jsonb;
BEGIN
  IF _audit_ids IS NULL AND NOT _all THEN RAISE EXCEPTION 'specify audit ids or _all'; END IF;
  FOR a IN SELECT * FROM person_pair_lane_audit WHERE lane = 'role_label' AND action = 'accept' AND undone_at IS NULL
    AND (_all OR id = ANY(_audit_ids)) ORDER BY id DESC LOOP
    IF (a.before_state->>'inserted')::boolean THEN
      DELETE FROM person_episode_mentions WHERE id = a.mention_id AND validation_source = 'deterministic_role_label_v1';
    ELSE
      UPDATE person_episode_mentions SET relevance_status = a.before_state->>'relevance_status',
        validation_source = a.before_state->>'validation_source',
        final_relevance_score = (a.before_state->>'final_relevance_score')::numeric,
        role_type = a.before_state->>'role_type', role_confidence = (a.before_state->>'role_confidence')::numeric,
        role_reason = a.before_state->>'role_reason', source_evidence = COALESCE(a.before_state->'source_evidence', '{}'::jsonb)
      WHERE id = a.mention_id AND validation_source = 'deterministic_role_label_v1' AND relevance_status = 'accepted';
    END IF;
    IF NOT FOUND THEN skipped := skipped + 1; CONTINUE; END IF;
    d := a.before_state->'disposition';
    IF d IS NOT NULL AND jsonb_typeof(d) = 'object' THEN
      UPDATE person_pair_dispositions SET disposition = d->>'disposition', reason_code = d->>'reason_code', decided_by = d->>'decided_by',
        policy_version = d->>'policy_version', detail = COALESCE(d->'detail', '{}'::jsonb), updated_at = now()
      WHERE person_id = a.person_id AND episode_id = a.episode_id AND decided_by = 'deterministic:role-label-v1';
    END IF;
    UPDATE person_pair_lane_audit SET undone_at = now(), undone_by = left(_by, 120) WHERE id = a.id;
    INSERT INTO person_pair_lane_audit (lane, action, person_id, episode_id, mention_id, rule_version, before_state, after_state, evidence)
    VALUES ('role_label', 'undo', a.person_id, a.episode_id, a.mention_id, a.rule_version, a.after_state, a.before_state, jsonb_build_object('undo_of', a.id, 'by', _by));
    UPDATE person_role_label_results SET outcome = 'undone', checked_at = now()
    WHERE person_id = a.person_id AND episode_id = a.episode_id AND rule_version = a.rule_version;
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('undone', n, 'skipped_changed', skipped);
END $$;

CREATE OR REPLACE FUNCTION public.person_page_fetch_targets_v1(_limit integer, _skip_domains text[])
RETURNS TABLE(episode_id uuid, url text, title text, rss_description text, podcast_description text, pairs integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '60s' AS $$
  WITH t AS (
    SELECT d.episode_id, min(CASE d.disposition WHEN 'source_needed' THEN 0 ELSE 1 END) pri,
      bool_or(pe.is_indexable) hi, count(*) n
    FROM person_pair_dispositions d JOIN people pe ON pe.id = d.person_id AND pe.is_public
    WHERE d.disposition IN ('source_needed','evidence_pending') AND d.reason_code <> 'waiting_clean_text'
    GROUP BY d.episode_id)
  SELECT e.id, e.episode_url, e.title, left(e.description, 6000), left(p.description, 3000), t.n::integer
  FROM t JOIN episodes e ON e.id = t.episode_id JOIN podcasts p ON p.id = e.podcast_id AND p.language_decision = 'accept_hungarian'
  LEFT JOIN episode_public_page_evidence g ON g.episode_id = e.id
  WHERE e.episode_url ~* '^https?://'
    AND NOT (lower(substring(e.episode_url from '^https?://([^/:?#]+)')) = ANY(COALESCE(_skip_domains, '{}'::text[])))
    AND (g.episode_id IS NULL OR (g.status IN ('http_error','fetch_error') AND g.attempts < 3 AND g.fetched_at < now() - interval '7 days'))
  ORDER BY t.pri, t.hi DESC, e.published_at DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 100)
$$;

CREATE OR REPLACE FUNCTION public.record_episode_page_evidence_v1(_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n integer;
BEGIN
  INSERT INTO episode_public_page_evidence AS g (episode_id, url, status, http_status, page_title, page_description, content_hash, error, fetched_at, updated_at)
  SELECT (x->>'episode_id')::uuid, left(x->>'url', 1000), x->>'status', NULLIF(x->>'http_status','')::integer, left(x->>'page_title', 400),
    left(x->>'page_description', 6000), x->>'content_hash', left(x->>'error', 300), now(), now()
  FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb)) x
  WHERE x->>'episode_id' IS NOT NULL AND x->>'status' IN ('ok','same_as_rss','show_level','no_meta','http_error','fetch_error','blocked')
    AND EXISTS (SELECT 1 FROM episodes e WHERE e.id = (x->>'episode_id')::uuid)
  ON CONFLICT (episode_id) DO UPDATE SET url = EXCLUDED.url, status = EXCLUDED.status, http_status = EXCLUDED.http_status,
    page_title = EXCLUDED.page_title, page_description = EXCLUDED.page_description, content_hash = EXCLUDED.content_hash,
    error = EXCLUDED.error, attempts = g.attempts + 1, fetched_at = now(), updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.classify_person_pair_dispositions_v1(_after_person uuid, _after_episode uuid, _limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '170s' AS $$
DECLARE lim integer := LEAST(GREATEST(COALESCE(_limit, 1000), 1), 20000); scanned integer; written integer; lp uuid; le uuid;
BEGIN
  DROP TABLE IF EXISTS pg_temp._ppd_keys;
  CREATE TEMP TABLE _ppd_keys ON COMMIT DROP AS
    SELECT DISTINCT m.person_id, m.episode_id FROM person_episode_mentions m
     WHERE (m.person_id, m.episode_id) > (COALESCE(_after_person, '00000000-0000-0000-0000-000000000000'::uuid),
                                          COALESCE(_after_episode, '00000000-0000-0000-0000-000000000000'::uuid))
     ORDER BY 1, 2 LIMIT lim;
  SELECT count(*) INTO scanned FROM _ppd_keys;
  SELECT person_id, episode_id INTO lp, le FROM _ppd_keys ORDER BY person_id DESC, episode_id DESC LIMIT 1;

  WITH pr AS (
    SELECT k.person_id, k.episode_id,
      bool_or(m.relevance_status = 'accepted') acc, bool_or(m.relevance_status = 'rejected') rej,
      bool_or(m.relevance_status = 'needs_review') nr, bool_or(m.relevance_status = 'pending') pend,
      bool_or(m.relevance_status = 'in_progress') inp, bool_or(m.relevance_status = 'waiting_clean_text') wct,
      bool_or(COALESCE(m.validation_source,'') ~* 'manual|chatgpt|external_review') man,
      bool_or(m.validation_source = 'person_openai_escalation_v1') esc,
      count(*) nrows, count(*) FILTER (WHERE m.relevance_status = 'needs_review') nr_rows,
      bool_or(m.ai_identity_match IN ('different_person_same_name','substring_false_positive')) namesake,
      bool_or(m.source = 'rss_author') rss_author
    FROM _ppd_keys k JOIN person_episode_mentions m ON m.person_id = k.person_id AND m.episode_id = k.episode_id
    GROUP BY 1, 2),
  x AS (
    SELECT pr.*, person.name pname, person.disambiguation_label, person.disambiguation_context,
      (COALESCE(person.identity_ambiguous, false) OR EXISTS (SELECT 1 FROM people o WHERE o.normalized_name = person.normalized_name
         AND o.id <> person.id AND o.is_public)) idrisk,
      e.title, e.description, e.summary, ct.cleaned_text, tr.transcript, tr.content_hash, pg.page_description,
      p.title ptitle, p.description pdesc,
      EXISTS (SELECT 1 FROM person_relevance_work w JOIN person_relevance_batch_jobs j ON j.id = w.claim_token
        WHERE w.person_id = pr.person_id AND w.episode_id = pr.episode_id AND w.lease_until > now()
          AND j.status IN ('claimed','uploading','submitted','validating','in_progress','finalizing','cancelling','ingesting')) open_lease,
      (SELECT i.decision->>'ai_suggested_status' FROM person_relevance_batch_items i WHERE i.tier = 'primary' AND i.person_id = pr.person_id
         AND i.episode_id = pr.episode_id AND i.status = 'applied' ORDER BY i.created_at DESC LIMIT 1) psug,
      (SELECT i.decision->>'ai_suggested_status' FROM person_relevance_batch_items i WHERE i.tier = 'escalation' AND i.person_id = pr.person_id
         AND i.episode_id = pr.episode_id AND i.status = 'applied' ORDER BY i.created_at DESC LIMIT 1) esug,
      (SELECT i.status FROM person_relevance_batch_items i WHERE i.person_id = pr.person_id AND i.episode_id = pr.episode_id
         AND i.tier IN ('primary','escalation') ORDER BY i.created_at DESC LIMIT 1) last_item,
      ARRAY(SELECT DISTINCT v FROM (
          SELECT public.unaccent(lower(person.name)) n UNION ALL
          SELECT public.unaccent(lower(a.alias)) FROM person_aliases a WHERE a.person_id = pr.person_id AND a.status = 'accepted'
            AND (a.scope = 'global' OR (a.scope = 'podcast' AND a.scope_podcast_id = e.podcast_id) OR (a.scope = 'episode' AND a.scope_episode_id = e.id))
        ) s CROSS JOIN LATERAL (VALUES (s.n), (CASE WHEN right(s.n, 2) IN ('cs','dz','gy','ly','ny','sz','ty','zs') THEN left(s.n, -2) || left(right(s.n, 2), 1) || right(s.n, 2) END)) vv(v)
        WHERE length(v) >= 3) names
    FROM pr JOIN people person ON person.id = pr.person_id
    JOIN episodes e ON e.id = pr.episode_id
    JOIN podcasts p ON p.id = e.podcast_id AND p.language_decision = 'accept_hungarian'
    LEFT JOIN episode_clean_text ct ON ct.episode_id = e.id AND ct.cleaner_method LIKE 'deterministic_v4%'
    LEFT JOIN episode_public_page_evidence pg ON pg.episode_id = e.id AND pg.status = 'ok'
    LEFT JOIN LATERAL (SELECT t.transcript, t.content_hash FROM episode_transcripts t WHERE t.episode_id = e.id AND t.status = 'ok'
      ORDER BY length(t.transcript) DESC LIMIT 1) tr ON true),
  y AS (
    SELECT x.*,
      EXISTS (SELECT 1 FROM (SELECT public.unaccent(lower(concat_ws(' ', title, description, summary, cleaned_text, transcript, page_description))) h) hh,
        unnest(names) n WHERE position(n IN hh.h) > 0) name_in_episode,
      EXISTS (SELECT 1 FROM (SELECT public.unaccent(lower(concat_ws(' ', ptitle, pdesc))) h) hh, unnest(names) n WHERE position(n IN hh.h) > 0) name_in_show,
      length(btrim(regexp_replace(regexp_replace(concat_ws(' ', title, cleaned_text, summary), 'https?://\S+', '', 'g'), '\s+', ' ', 'g'))) useful_len
    FROM x),
  c AS (
    SELECT y.person_id, y.episode_id,
      CASE
        WHEN acc THEN 'decided_accepted|accepted_link'
        WHEN rej AND NOT nr AND NOT pend AND NOT inp AND NOT wct THEN 'decided_rejected|rejected_link'
        WHEN open_lease THEN 'in_progress|active_batch_or_lease'
        WHEN inp THEN 'technical_retry|stale_mention_claim'
        WHEN man THEN 'human_contradiction_review|manual_review_conflict'
        WHEN (pend OR nr) AND NOT name_in_episode THEN
          CASE WHEN rss_author AND name_in_show THEN 'insufficient_evidence|rss_author_credit_show_confirmed'
               WHEN rss_author THEN 'insufficient_evidence|rss_author_credit_only'
               ELSE 'insufficient_evidence|name_not_in_available_sources' END
        WHEN pend AND useful_len < 100 THEN 'source_needed|short_source_parked'
        WHEN pend THEN 'first_round_pending|first_round_not_done'
        WHEN wct THEN 'source_needed|waiting_clean_text'
        WHEN nr AND cleaned_text IS NULL AND transcript IS NULL AND page_description IS NULL
             AND length(COALESCE(description,'') || COALESCE(summary,'')) < 200 THEN 'source_needed|no_usable_source_text'
        WHEN nr AND idrisk THEN 'human_identity_review|same_name_or_ambiguous_person'
        WHEN nr AND ((psug = 'accepted' AND esug = 'rejected') OR (psug = 'rejected' AND esug = 'accepted')) THEN 'human_contradiction_review|ai_opinions_conflict'
        WHEN nr AND last_item IN ('failed','invalid','refused','expired') AND psug IS NULL AND esug IS NULL THEN 'technical_retry|last_request_failed'
        WHEN nr THEN 'evidence_pending|needs_targeted_evidence'
        ELSE 'other|unclassified_state' END dr,
      md5(concat_ws('|', 'pair-disposition-v5', array_to_string(names, ','), md5(COALESCE(title,'')), md5(COALESCE(description,'')),
        md5(COALESCE(summary,'')), md5(COALESCE(cleaned_text,'')), COALESCE(content_hash, md5(COALESCE(transcript,''))), md5(COALESCE(page_description,'')))) fp,
      jsonb_strip_nulls(jsonb_build_object('rows', nrows, 'dup_rows', CASE WHEN acc THEN nr_rows END,
        'after_escalation', NULLIF(esc, false), 'missing_disambiguation', CASE WHEN disambiguation_label IS NULL AND disambiguation_context IS NULL THEN true END,
        'long_text', CASE WHEN length(cleaned_text) > 6000 THEN true END, 'no_clean_text', CASE WHEN cleaned_text IS NULL THEN true END,
        'has_transcript', CASE WHEN transcript IS NOT NULL THEN true END, 'has_page_evidence', CASE WHEN page_description IS NOT NULL THEN true END,
        'primary_suggested', psug, 'escalation_suggested', esug,
        'namesake_suggested', NULLIF(namesake, false), 'rss_author', NULLIF(rss_author, false), 'identity_risk', NULLIF(idrisk, false))) detail
    FROM y)
  INSERT INTO person_pair_dispositions AS d (person_id, episode_id, disposition, reason_code, source_fingerprint, policy_version, detail, decided_by)
  SELECT person_id, episode_id, split_part(dr, '|', 1), split_part(dr, '|', 2), fp, 'pair-disposition-v5', detail, 'deterministic:pair-disposition-v5'
    FROM c
  ON CONFLICT (person_id, episode_id) DO UPDATE SET disposition = EXCLUDED.disposition, reason_code = EXCLUDED.reason_code,
    source_fingerprint = EXCLUDED.source_fingerprint, policy_version = EXCLUDED.policy_version, detail = EXCLUDED.detail,
    decided_by = EXCLUDED.decided_by, updated_at = now()
  WHERE (d.decided_by NOT LIKE 'human:%'
         AND (d.disposition, d.reason_code, COALESCE(d.source_fingerprint,''), d.detail) IS DISTINCT FROM
             (EXCLUDED.disposition, EXCLUDED.reason_code, COALESCE(EXCLUDED.source_fingerprint,''), EXCLUDED.detail))
     OR (d.decided_by LIKE 'human:%' AND d.reopen_on_source_change AND d.source_fingerprint IS DISTINCT FROM EXCLUDED.source_fingerprint);
  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN jsonb_build_object('scanned', scanned, 'written', written, 'last_person', lp, 'last_episode', le);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.person_role_label_candidates_v1(uuid, uuid, integer)',
    'public.record_person_role_label_results_v1(jsonb)',
    'public.apply_person_role_label_v1(jsonb)',
    'public.undo_person_role_label_v1(bigint[], boolean, text)',
    'public.person_page_fetch_targets_v1(integer, text[])',
    'public.record_episode_page_evidence_v1(jsonb)',
    'public.classify_person_pair_dispositions_v1(uuid, uuid, integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM readonly_codex', f);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;