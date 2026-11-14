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
      bool_or(m.relevance_status = 'resolved_show_host') shr,
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
        WHEN shr THEN 'resolved_show_host|verified_show_host_rule'
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
  -- Only rows this classifier (or the role-label lane) wrote are rewritten; other deciders keep their rows.
  WHERE ((d.decided_by IS NULL OR d.decided_by LIKE 'deterministic:pair-disposition-%' OR d.decided_by = 'deterministic:role-label-v1')
         AND (d.disposition, d.reason_code, COALESCE(d.source_fingerprint,''), d.detail) IS DISTINCT FROM
             (EXCLUDED.disposition, EXCLUDED.reason_code, COALESCE(EXCLUDED.source_fingerprint,''), EXCLUDED.detail))
     OR (d.decided_by LIKE 'human:%' AND d.reopen_on_source_change AND d.source_fingerprint IS DISTINCT FROM EXCLUDED.source_fingerprint);
  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN jsonb_build_object('scanned', scanned, 'written', written, 'last_person', lp, 'last_episode', le);
END $$;
REVOKE ALL ON FUNCTION public.classify_person_pair_dispositions_v1(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classify_person_pair_dispositions_v1(uuid, uuid, integer) TO service_role;