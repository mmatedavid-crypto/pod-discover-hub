-- One-time: close already-reviewed pairs where both AI reviews rejected. The judge
-- source hash includes review fields, so freshness is checked instead by CAS against
-- the escalation audit row and clean text not changed since the escalation apply.
-- Audited under the escalation job id → rollback_person_openai_batch_job undoes it.
DO $$
DECLARE r record; m record; a record; after_row jsonb; prot boolean; ok boolean;
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
    IF EXISTS (SELECT 1 FROM episode_clean_text c WHERE c.episode_id = r.episode_id AND c.updated_at > r.applied_at) THEN CONTINUE; END IF;
    PERFORM 1 FROM person_episode_mentions WHERE person_id = r.person_id AND episode_id = r.episode_id ORDER BY id FOR UPDATE;
    SELECT bool_or(relevance_status IN ('accepted','rejected','in_progress') OR COALESCE(validation_source,'') ~* 'manual|chatgpt|external_review')
      INTO prot FROM person_episode_mentions WHERE person_id = r.person_id AND episode_id = r.episode_id;
    IF COALESCE(prot, false) THEN CONTINUE; END IF;
    -- Every open row must still be exactly what the escalation apply wrote.
    ok := true;
    FOR m IN SELECT * FROM person_episode_mentions WHERE person_id = r.person_id AND episode_id = r.episode_id
      AND relevance_status = 'needs_review' AND validation_source = 'person_openai_escalation_v1' LOOP
      SELECT * INTO a FROM person_relevance_batch_audit WHERE item_id = r.id AND mention_id = m.id AND rolled_back_at IS NULL ORDER BY id DESC LIMIT 1;
      IF a IS NULL OR m.ai_judged_at IS DISTINCT FROM (a.after->>'ai_judged_at')::timestamptz
        OR m.mention_type IS DISTINCT FROM a.after->>'mention_type' THEN ok := false; END IF;
    END LOOP;
    IF NOT ok THEN CONTINUE; END IF;
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