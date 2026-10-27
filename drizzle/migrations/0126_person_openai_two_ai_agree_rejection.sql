-- Owner decision 2026-10-27: when both independent AI reviews (primary + stronger
-- escalation) say the person is not in the episode, the link is closed as rejected.
-- Escalation must quote the source; one AI opinion alone never closes a link.
CREATE OR REPLACE FUNCTION public.apply_person_openai_escalation_item(_item uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE it person_relevance_batch_items; w person_relevance_work; d jsonb; pd jsonb; final text; wanted text; role text;
  canonical uuid; m record; after_row jsonb; changed integer := 0; protected boolean;
BEGIN
  SELECT * INTO it FROM person_relevance_batch_items WHERE id = _item FOR UPDATE;
  IF NOT FOUND OR it.status <> 'succeeded' OR it.tier <> 'escalation' THEN RAISE EXCEPTION 'item_not_applicable'; END IF;
  d := it.decision; final := it.final_status; wanted := d->>'mention_type';
  IF final NOT IN ('accepted','rejected','needs_review') OR wanted NOT IN ('host','guest','subject','mentioned','none')
    OR COALESCE((d->>'score')::numeric, -1) NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  IF final = 'accepted' AND (wanted = 'none' OR d->>'identity_match' IS DISTINCT FROM 'same_person'
    OR (d->>'score')::numeric < 0.85 OR jsonb_array_length(COALESCE(d->'evidence_phrases','[]')) = 0 OR it.identity_risk)
    THEN RAISE EXCEPTION 'unsafe_acceptance'; END IF;
  IF final = 'rejected' THEN
    SELECT decision INTO pd FROM person_relevance_batch_items WHERE id = it.prior_item_id AND tier = 'primary';
    IF NOT (d->>'status' = 'rejected'
      AND jsonb_array_length(COALESCE(d->'evidence_phrases','[]')) > 0
      AND pd->>'ai_suggested_status' = 'rejected')
    THEN final := 'needs_review'; END IF;
  END IF;
  SELECT * INTO w FROM person_relevance_work WHERE person_id = it.person_id AND episode_id = it.episode_id FOR UPDATE;
  IF NOT FOUND OR w.claim_token IS DISTINCT FROM it.job_id THEN
    UPDATE person_relevance_batch_items SET status = 'skipped_stale', error = 'lease_lost', updated_at = now() WHERE id = _item;
    RETURN jsonb_build_object('status', 'skipped_stale', 'reason', 'lease_lost');
  END IF;
  PERFORM 1 FROM person_episode_mentions WHERE person_id = it.person_id AND episode_id = it.episode_id ORDER BY id FOR UPDATE;
  IF md5(public.person_judge_source(it.person_id, it.episode_id)::text) IS DISTINCT FROM it.source_hash THEN
    UPDATE person_relevance_batch_items SET status = 'skipped_stale', error = 'source_changed', updated_at = now() WHERE id = _item;
    UPDATE person_relevance_work SET lease_until = now(), updated_at = now() WHERE person_id = it.person_id AND episode_id = it.episode_id;
    RETURN jsonb_build_object('status', 'skipped_stale', 'reason', 'source_changed');
  END IF;
  SELECT bool_or(relevance_status IN ('accepted','rejected','in_progress') OR COALESCE(validation_source,'') ~* 'manual|chatgpt|external_review')
    INTO protected FROM person_episode_mentions WHERE person_id = it.person_id AND episode_id = it.episode_id;
  IF COALESCE(protected, false) THEN
    UPDATE person_relevance_batch_items SET status = 'skipped_protected', updated_at = now() WHERE id = _item;
    UPDATE person_relevance_work SET lease_until = now(), updated_at = now() WHERE person_id = it.person_id AND episode_id = it.episode_id;
    RETURN jsonb_build_object('status', 'skipped_protected');
  END IF;
  IF final = 'accepted' THEN
    SELECT id INTO canonical FROM person_episode_mentions
      WHERE person_id = it.person_id AND episode_id = it.episode_id AND mention_type = wanted
        AND (relevance_status = 'pending' OR (relevance_status = 'needs_review' AND validation_source = 'person_openai_batch_v1'))
      ORDER BY id LIMIT 1;
    IF canonical IS NULL AND NOT EXISTS (SELECT 1 FROM person_episode_mentions
      WHERE person_id = it.person_id AND episode_id = it.episode_id AND mention_type = wanted) THEN
      SELECT id INTO canonical FROM person_episode_mentions
        WHERE person_id = it.person_id AND episode_id = it.episode_id
          AND (relevance_status = 'pending' OR (relevance_status = 'needs_review' AND validation_source = 'person_openai_batch_v1'))
        ORDER BY id LIMIT 1;
    END IF;
    IF canonical IS NULL THEN final := 'needs_review'; END IF;
  END IF;
  role := CASE wanted WHEN 'host' THEN 'participant' WHEN 'guest' THEN 'participant' WHEN 'subject' THEN 'subject' ELSE 'mention' END;
  FOR m IN SELECT * FROM person_episode_mentions WHERE person_id = it.person_id AND episode_id = it.episode_id
    AND (relevance_status = 'pending' OR (relevance_status = 'needs_review' AND validation_source = 'person_openai_batch_v1'))
    ORDER BY id LOOP
    UPDATE person_episode_mentions SET
      relevance_status = CASE WHEN final = 'accepted' AND id <> canonical THEN 'needs_review' ELSE final END,
      mention_type = CASE WHEN final = 'accepted' AND id = canonical THEN wanted ELSE mention_type END,
      role_type = CASE WHEN final = 'accepted' AND id = canonical THEN role ELSE role_type END,
      role_confidence = CASE WHEN final = 'accepted' AND id = canonical THEN (d->>'score')::numeric ELSE role_confidence END,
      role_reason = CASE WHEN final = 'accepted' AND id = canonical THEN d->>'reason' ELSE role_reason END,
      final_relevance_score = (d->>'score')::numeric,
      validation_source = 'person_openai_escalation_v1',
      ai_identity_match = d->>'identity_match',
      ai_reason = CASE WHEN final = 'accepted' AND id <> canonical
        THEN 'Ismétlődő szerepsor; a kanonikus sor elfogadva.'
        WHEN final = 'rejected' THEN left('Két AI-ellenőrzés egyezően elutasította. ' || coalesce(d->>'reason',''), 240)
        ELSE left(d->>'reason', 240) END,
      ai_evidence_phrases = ARRAY(SELECT jsonb_array_elements_text(COALESCE(d->'evidence_phrases','[]'))),
      ai_judged_at = now(), ai_model = d->>'model'
    WHERE id = m.id
    RETURNING to_jsonb(person_episode_mentions.*) INTO after_row;
    INSERT INTO person_relevance_batch_audit(job_id, item_id, mention_id, before, after)
    VALUES (it.job_id, it.id, m.id, to_jsonb(m), after_row);
    changed := changed + 1;
  END LOOP;
  UPDATE person_relevance_batch_items SET status = 'applied', final_status = final, applied_at = now(), updated_at = now() WHERE id = _item;
  UPDATE person_relevance_work SET cached_hash = it.source_hash, cached_decision = d, model_used = d->>'model',
    lease_until = now(), updated_at = now() WHERE person_id = it.person_id AND episode_id = it.episode_id;
  RETURN jsonb_build_object('status', final, 'changed_rows', changed, 'canonical_id', canonical);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_person_openai_escalation_item(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_person_openai_escalation_item(uuid) TO service_role;

-- One-time: close already-reviewed pairs that meet the new rule. Audited per row
-- under the escalation job id, so rollback_person_openai_batch_job undoes it.
DO $$
DECLARE r record; m record; after_row jsonb; prot boolean;
BEGIN
  FOR r IN
    SELECT e.* FROM person_relevance_batch_items e
    JOIN person_relevance_batch_items p ON p.id = e.prior_item_id AND p.tier = 'primary'
    WHERE e.tier = 'escalation' AND e.status = 'applied' AND e.final_status = 'needs_review'
      AND e.decision->>'status' = 'rejected'
      AND jsonb_array_length(COALESCE(e.decision->'evidence_phrases','[]')) > 0
      AND p.decision->>'ai_suggested_status' = 'rejected'
  LOOP
    IF EXISTS (SELECT 1 FROM person_relevance_work w WHERE w.person_id = r.person_id AND w.episode_id = r.episode_id AND w.lease_until > now()) THEN CONTINUE; END IF;
    PERFORM 1 FROM person_episode_mentions WHERE person_id = r.person_id AND episode_id = r.episode_id ORDER BY id FOR UPDATE;
    IF md5(public.person_judge_source(r.person_id, r.episode_id)::text) IS DISTINCT FROM r.source_hash THEN CONTINUE; END IF;
    SELECT bool_or(relevance_status IN ('accepted','rejected','in_progress') OR COALESCE(validation_source,'') ~* 'manual|chatgpt|external_review')
      INTO prot FROM person_episode_mentions WHERE person_id = r.person_id AND episode_id = r.episode_id;
    IF COALESCE(prot, false) THEN CONTINUE; END IF;
    FOR m IN SELECT * FROM person_episode_mentions WHERE person_id = r.person_id AND episode_id = r.episode_id
      AND relevance_status = 'needs_review' AND validation_source = 'person_openai_escalation_v1' ORDER BY id LOOP
      UPDATE person_episode_mentions SET relevance_status = 'rejected',
        ai_reason = left('Két AI-ellenőrzés egyezően elutasította. ' || coalesce(r.decision->>'reason',''), 240)
      WHERE id = m.id RETURNING to_jsonb(person_episode_mentions.*) INTO after_row;
      INSERT INTO person_relevance_batch_audit(job_id, item_id, mention_id, before, after)
      VALUES (r.job_id, r.id, m.id, to_jsonb(m), after_row);
    END LOOP;
    UPDATE person_relevance_batch_items SET final_status = 'rejected', updated_at = now() WHERE id = r.id;
  END LOOP;
END $$;