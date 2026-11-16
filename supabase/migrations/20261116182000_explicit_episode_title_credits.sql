-- Explicit publisher credits may occur in the episode title itself.
-- Description remains the default. Title rules require explicit identity anchors
-- and may only accept positively named participants, never infer absence.
ALTER TABLE public.person_episode_credit_rules ADD COLUMN IF NOT EXISTS source_field text NOT NULL DEFAULT 'episode_description';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.person_episode_credit_rules'::regclass AND conname='person_episode_credit_source_field_check') THEN
  ALTER TABLE public.person_episode_credit_rules ADD CONSTRAINT person_episode_credit_source_field_check CHECK(
   source_field='episode_description' OR
   (source_field='episode_title' AND match_action='accept_participant' AND NOT correct_feed_credits AND cardinality(anchor_person_ids)>0));
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.person_episode_credit_decide_v1(_person uuid, _episode uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; names text[]; fq text; hit boolean; oc text; full_text text;
BEGIN
  FOR r IN SELECT ru.*, e.title, e.description, e.podcast_id AS ep_podcast,
             public.person_episode_credit_capture_v1(ru.credit_pattern, ru.title_pattern, e.title, CASE WHEN ru.source_field='episode_title' THEN e.title ELSE e.description END) q
           FROM person_episode_credit_rules ru JOIN episodes e ON e.id = _episode AND e.podcast_id = ru.podcast_id
           WHERE ru.active ORDER BY ru.rule_key LOOP
    CONTINUE WHEN r.q IS NULL OR length(r.q) < 3;
    IF names IS NULL THEN
      names := ARRAY(SELECT pe.name FROM people pe WHERE pe.id = _person
        UNION SELECT a.alias FROM person_aliases a WHERE a.person_id = _person AND a.status = 'accepted'
          AND (a.scope = 'global' OR (a.scope = 'podcast' AND a.scope_podcast_id = r.ep_podcast)));
    END IF;
    fq := public.person_text_fold_v1(r.q);
    hit := EXISTS (SELECT 1 FROM unnest(names) n WHERE public.person_credit_name_in_text_v1(n, fq));
    oc := NULL;
    IF hit THEN
      IF r.source_field='episode_title' AND NOT (_person = ANY(r.anchor_person_ids)) THEN CONTINUE; END IF;
      IF r.match_action <> 'accept_participant' THEN CONTINUE; END IF;
      IF _person = ANY (r.anchor_person_ids) OR EXISTS (
           SELECT 1 FROM people p WHERE p.id = _person AND NOT COALESCE(p.identity_ambiguous, false)
             AND COALESCE(p.identity_status, 'normal') IN ('normal', 'confirmed', 'context_resolved')
             AND NOT EXISTS (SELECT 1 FROM people o WHERE o.normalized_name = p.normalized_name AND o.id <> p.id AND o.is_public)
             AND NOT EXISTS (SELECT 1 FROM person_episode_mentions x WHERE x.person_id = _person AND x.relevance_status = 'accepted'
                               AND x.podcast_id IS DISTINCT FROM r.ep_podcast)) THEN
        oc := 'credited_role';
      ELSE
        oc := 'credit_identity_unanchored';
      END IF;

    END IF;
    IF oc IS NOT NULL THEN
      RETURN jsonb_build_object('rule_id', r.id, 'outcome', oc, 'quote', r.q, 'role', r.credit_role, 'version', r.version,
        'source_url', r.source_url, 'source_hash', r.source_hash, 'provenance', r.provenance, 'source_field', r.source_field);
    END IF;
  END LOOP;
  RETURN NULL;
END $function$;
CREATE OR REPLACE FUNCTION public.apply_person_episode_credit_rules_v1(_limit integer DEFAULT 2000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '170s'
AS $function$
DECLARE n integer; nm integer; unanchored integer;
BEGIN
  DROP TABLE IF EXISTS pg_temp._credit_cand;
  CREATE TEMP TABLE _credit_cand ON COMMIT DROP AS
  SELECT k.person_id, k.episode_id, public.person_episode_credit_decide_v1(k.person_id, k.episode_id) dec
  FROM (SELECT DISTINCT m.person_id, m.episode_id FROM person_episode_mentions m
        JOIN episodes e ON e.id = m.episode_id
        WHERE e.podcast_id IN (SELECT podcast_id FROM person_episode_credit_rules WHERE active)
          AND m.relevance_status IN ('pending','needs_review','waiting_clean_text','in_progress','resolved_show_host')
          AND NOT EXISTS (SELECT 1 FROM person_episode_credit_resolutions x WHERE x.person_id = m.person_id AND x.episode_id = m.episode_id
                            AND (x.undone_at IS NULL OR x.rule_version = (SELECT r.version FROM person_episode_credit_rules r WHERE r.id = x.rule_id)))) k;
  SELECT count(*) INTO unanchored FROM _credit_cand WHERE dec->>'outcome' = 'credit_identity_unanchored';
  DROP TABLE IF EXISTS pg_temp._credit_apply;
  CREATE TEMP TABLE _credit_apply ON COMMIT DROP AS
  SELECT c.person_id, c.episode_id, c.dec, (c.dec->>'rule_id')::uuid rule_id, c.dec->>'outcome' outcome
  FROM _credit_cand c
  WHERE c.dec->>'outcome' IN ('credited_role','feed_credit_not_episode')
    AND public.person_episode_credit_pair_ok_v1(c.person_id, c.episode_id, c.dec->>'outcome')
  ORDER BY c.episode_id, c.person_id
  LIMIT LEAST(GREATEST(_limit, 1), 10000);

  INSERT INTO person_episode_credit_resolutions (rule_id, rule_version, person_id, episode_id, outcome, credit_quote, before_mentions, before_disposition)
  SELECT a.rule_id, a.dec->>'version', a.person_id, a.episode_id, a.outcome, a.dec->>'quote',
    COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM person_episode_mentions m WHERE m.person_id = a.person_id AND m.episode_id = a.episode_id), '[]'::jsonb),
    (SELECT to_jsonb(d) FROM person_pair_dispositions d WHERE d.person_id = a.person_id AND d.episode_id = a.episode_id)
  FROM _credit_apply a;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Owner/publisher-sourced credit is allowed to lift a show-roster pair to an explicit appearance.
  PERFORM set_config('podiverzum.host_rule_undo', 'on', true);
  PERFORM set_config('podiverzum.episode_credit_write', 'on', true);
  UPDATE person_episode_mentions m SET
    relevance_status = CASE WHEN a.outcome = 'credited_role' THEN 'accepted' ELSE 'resolved_feed_credit_not_episode' END,
    role_type = CASE WHEN a.outcome = 'credited_role' THEN 'participant' ELSE m.role_type END,
    validation_source = CASE WHEN a.outcome = 'credited_role' THEN 'deterministic_episode_credit_v1' ELSE 'deterministic_feed_credit_correction_v1' END,
    source_evidence = COALESCE(m.source_evidence, '{}') || jsonb_build_object('episode_credit_rule_id', a.rule_id, 'credit_role', a.dec->>'role',
      'credit_quote', a.dec->>'quote', 'source_field', COALESCE(a.dec->>'source_field','episode_description'), 'source_url', a.dec->>'source_url', 'source_hash', a.dec->>'source_hash',
      'provenance', CASE WHEN a.outcome = 'credited_role' THEN 'explicit_episode_credit' ELSE 'feed_credit_correction' END, 'rule_version', a.dec->>'version'),
    role_reason = CASE WHEN a.outcome = 'credited_role'
      THEN 'Az epizód kiadói ' || CASE WHEN a.dec->>'source_field'='episode_title' THEN 'címe' ELSE 'leírása' END || ' név szerint megnevezi (' || (a.dec->>'role') || '): „' || left(a.dec->>'quote', 200) || '”.'
      ELSE 'A jelölt csak a műsor RSS-szerzőmezőjéből keletkezett; az epizód leírása kifejezetten mást nevez meg („' || left(a.dec->>'quote', 160)
        || '”). Ez a hibás automatikus jelölés javítása, nem bizonyított nemszereplés.' END
  FROM _credit_apply a WHERE m.person_id = a.person_id AND m.episode_id = a.episode_id
    AND m.relevance_status IN ('pending','needs_review','waiting_clean_text','in_progress','resolved_show_host');
  GET DIAGNOSTICS nm = ROW_COUNT;

  INSERT INTO person_pair_dispositions AS d (person_id, episode_id, disposition, reason_code, policy_version, decided_by, detail, reopen_on_source_change)
  SELECT a.person_id, a.episode_id,
    CASE WHEN a.outcome = 'credited_role' THEN 'decided_accepted' ELSE 'resolved_feed_credit_not_episode' END,
    CASE WHEN a.outcome = 'credited_role' THEN 'explicit_episode_credit' ELSE 'explicit_other_credit' END,
    a.dec->>'version', 'deterministic:episode-credit-v1',
    jsonb_build_object('episode_credit_rule_id', a.rule_id, 'credit_role', a.dec->>'role', 'credit_quote', a.dec->>'quote'), false
  FROM _credit_apply a
  ON CONFLICT (person_id, episode_id) DO UPDATE SET disposition = EXCLUDED.disposition, reason_code = EXCLUDED.reason_code,
    policy_version = EXCLUDED.policy_version, decided_by = EXCLUDED.decided_by,
    detail = COALESCE(d.detail, '{}') || EXCLUDED.detail, reopen_on_source_change = false, updated_at = now();
  PERFORM set_config('podiverzum.host_rule_undo', 'off', true);
  PERFORM set_config('podiverzum.episode_credit_write', 'off', true);

  RETURN jsonb_build_object('resolved_pairs', n, 'updated_mentions', nm,
    'credited_role', (SELECT count(*) FROM _credit_apply WHERE outcome = 'credited_role'),
    'feed_credit_not_episode', (SELECT count(*) FROM _credit_apply WHERE outcome = 'feed_credit_not_episode'),
    'skipped_identity_unanchored', unanchored);
END $function$;
