-- Pair dispositions v4: source checks run before the identity check, so a name that never appears in the
-- episode texts (often only an RSS author credit) is not counted as human identity work. Restart the pass.
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
      e.title, e.description, e.summary, ct.cleaned_text, tr.transcript, tr.content_hash,
      EXISTS (SELECT 1 FROM person_relevance_work w WHERE w.person_id = pr.person_id AND w.episode_id = pr.episode_id AND w.lease_until > now()) leased,
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
    LEFT JOIN LATERAL (SELECT t.transcript, t.content_hash FROM episode_transcripts t WHERE t.episode_id = e.id AND t.status = 'ok'
      ORDER BY length(t.transcript) DESC LIMIT 1) tr ON true),
  c AS (
    SELECT x.person_id, x.episode_id,
      CASE
        WHEN acc THEN 'decided_accepted|accepted_link'
        WHEN rej AND NOT nr AND NOT pend AND NOT inp AND NOT wct THEN 'decided_rejected|rejected_link'
        WHEN inp OR leased THEN 'in_progress|active_batch_or_lease'
        WHEN man THEN 'human_contradiction_review|manual_review_conflict'
        WHEN pend THEN 'first_round_pending|first_round_not_done'
        WHEN wct THEN 'source_needed|waiting_clean_text'
        WHEN nr AND cleaned_text IS NULL AND transcript IS NULL AND length(COALESCE(description,'') || COALESCE(summary,'')) < 200 THEN 'source_needed|no_usable_source_text'
        WHEN nr AND NOT EXISTS (SELECT 1 FROM (SELECT public.unaccent(lower(concat_ws(' ', title, description, summary, cleaned_text, transcript))) h) hh, unnest(names) n WHERE position(n IN hh.h) > 0)
          THEN CASE WHEN rss_author THEN 'insufficient_evidence|rss_author_credit_only' ELSE 'insufficient_evidence|name_not_in_available_sources' END
        WHEN nr AND idrisk THEN 'human_identity_review|same_name_or_ambiguous_person'
        WHEN nr AND ((psug = 'accepted' AND esug = 'rejected') OR (psug = 'rejected' AND esug = 'accepted')) THEN 'human_contradiction_review|ai_opinions_conflict'
        WHEN nr AND last_item IN ('failed','invalid','refused','expired') AND psug IS NULL AND esug IS NULL THEN 'technical_retry|last_request_failed'
        WHEN nr THEN 'evidence_pending|needs_targeted_evidence'
        ELSE 'other|unclassified_state' END dr,
      md5(concat_ws('|', 'pair-disposition-v4', array_to_string(names, ','), md5(COALESCE(title,'')), md5(COALESCE(description,'')),
        md5(COALESCE(summary,'')), md5(COALESCE(cleaned_text,'')), COALESCE(content_hash, md5(COALESCE(transcript,''))))) fp,
      jsonb_strip_nulls(jsonb_build_object('rows', nrows, 'dup_rows', CASE WHEN acc THEN nr_rows END,
        'after_escalation', NULLIF(esc, false), 'missing_disambiguation', CASE WHEN disambiguation_label IS NULL AND disambiguation_context IS NULL THEN true END,
        'long_text', CASE WHEN length(cleaned_text) > 6000 THEN true END, 'no_clean_text', CASE WHEN cleaned_text IS NULL THEN true END,
        'has_transcript', CASE WHEN transcript IS NOT NULL THEN true END, 'primary_suggested', psug, 'escalation_suggested', esug,
        'namesake_suggested', NULLIF(namesake, false), 'rss_author', NULLIF(rss_author, false), 'identity_risk', NULLIF(idrisk, false))) detail
    FROM x)
  INSERT INTO person_pair_dispositions AS d (person_id, episode_id, disposition, reason_code, source_fingerprint, policy_version, detail, decided_by)
  SELECT person_id, episode_id, split_part(dr, '|', 1), split_part(dr, '|', 2), fp, 'pair-disposition-v4', detail, 'deterministic:pair-disposition-v4'
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

UPDATE public.app_settings SET value = jsonb_build_object('passes_completed', 0, 'restarted_for', 'pair-disposition-v4', 'restarted_at', now())
WHERE key = 'person_pair_disposition_cursor';