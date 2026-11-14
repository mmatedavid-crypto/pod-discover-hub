CREATE OR REPLACE FUNCTION public.person_role_label_anchor_v1(_person uuid, _podcast uuid, _quote text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  -- _quote is the person's own descriptor window (their list item), never the whole line.
  SELECT CASE
    WHEN pe.wikidata_id IS NULL AND COALESCE(pe.wikipedia_match_status,'') <> 'verified'
      AND NOT EXISTS (SELECT 1 FROM person_episode_mentions m WHERE m.person_id = _person AND m.podcast_id <> _podcast)
      AND prior.n > 0
      THEN jsonb_build_object('anchor', 'show_local_record', 'podcast_id', _podcast, 'prior_reviewed_accepts_on_show', prior.n,
        'prior_validation_sources', prior.srcs)
    WHEN pe.wikipedia_match_status = 'verified' AND pe.wikidata_id IS NOT NULL AND w.word IS NOT NULL
      THEN jsonb_build_object('anchor', 'wiki_context', 'wikidata_id', pe.wikidata_id, 'descriptor', w.word,
        'wikipedia_description', left(pe.wikipedia_description, 200))
  END
  FROM people pe
  CROSS JOIN LATERAL (
    SELECT count(DISTINCT m.episode_id) n, to_jsonb(array_agg(DISTINCT m.validation_source)) srcs
    FROM person_episode_mentions m
    WHERE m.person_id = _person AND m.podcast_id = _podcast AND m.relevance_status = 'accepted'
      AND COALESCE(m.validation_source, '') NOT IN ('', 'deterministic_role_label_v1')) prior
  LEFT JOIN LATERAL (
    SELECT q.t word
    FROM regexp_split_to_table(public.person_text_fold_v1(_quote), '[^a-z]+') q(t),
         regexp_split_to_table(public.person_text_fold_v1(concat_ws(' ', pe.wikipedia_description, pe.disambiguation_label)), '[^a-z]+') d(t)
    WHERE _quote IS NOT NULL AND length(q.t) >= 6 AND length(d.t) >= 6
      AND (position(q.t IN d.t) > 0 OR position(d.t IN q.t) > 0)
      AND position(q.t IN public.person_text_fold_v1(pe.name)) = 0 AND position(d.t IN public.person_text_fold_v1(pe.name)) = 0
      AND d.t NOT IN ('magyar','magyarorszag','hungarian','szuletett','egyesult','amerikai','nemzetkozi','budapest','budapesti','foglalkozas')
    LIMIT 1) w ON true
  WHERE pe.id = _person
$$;

CREATE OR REPLACE FUNCTION public.person_role_label_block_v1(_person uuid, _episode uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN pe.id IS NULL OR e.id IS NULL THEN 'missing'
    WHEN p.language_decision IS DISTINCT FROM 'accept_hungarian' THEN 'not_hungarian_show'
    WHEN COALESCE(pe.identity_ambiguous,false) OR COALESCE(pe.duplicate_candidate,false) OR COALESCE(pe.needs_human_review_identity,false)
      OR COALESCE(pe.identity_status,'normal') NOT IN ('normal','confirmed','context_resolved')
      OR COALESCE(pe.ai_review_status,'') IN ('needs_human_review','duplicate_candidate')
      OR COALESCE(pe.ai_recommended_action,'') IN ('hide','reject')
      OR COALESCE(pe.activation_status,'') IN ('inactive','hidden','rejected') THEN 'person_identity_flag'
    WHEN EXISTS (SELECT 1 FROM people o WHERE o.normalized_name = pe.normalized_name AND o.id <> pe.id
      AND COALESCE(o.identity_status,'') <> 'merged_into') THEN 'catalog_homonym'
    WHEN COALESCE(pe.is_historical,false) OR (pe.date_of_death IS NOT NULL AND pe.date_of_death < e.published_at::date)
      OR (pe.date_of_birth IS NOT NULL AND pe.date_of_birth < date '1900-01-01') THEN 'historical_person'
    WHEN EXISTS (SELECT 1 FROM person_episode_mentions m WHERE m.person_id = _person AND m.episode_id = _episode
      AND (m.relevance_status IN ('accepted','rejected','in_progress') OR COALESCE(m.validation_source,'') ~* 'manual|chatgpt|external_review'
           OR m.ai_identity_match IN ('different_person_same_name','substring_false_positive'))) THEN 'pair_decided_or_conflict'
    WHEN EXISTS (SELECT 1 FROM person_pair_dispositions d WHERE d.person_id = _person AND d.episode_id = _episode
      AND (d.disposition IN ('human_identity_review','human_contradiction_review','decided_rejected','decided_accepted') OR d.decided_by LIKE 'human:%')) THEN 'pair_review_state'
    WHEN EXISTS (SELECT 1 FROM person_relevance_work w JOIN person_relevance_batch_jobs j ON j.id = w.claim_token
      WHERE w.person_id = _person AND w.episode_id = _episode AND w.lease_until > now()
        AND j.status IN ('claimed','uploading','submitted','validating','in_progress','finalizing','cancelling','ingesting')) THEN 'open_batch_job'
  END
  FROM (SELECT 1) one
  LEFT JOIN people pe ON pe.id = _person
  LEFT JOIN episodes e ON e.id = _episode
  LEFT JOIN podcasts p ON p.id = e.podcast_id
$$;

REVOKE ALL ON FUNCTION public.person_role_label_anchor_v1(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.person_role_label_block_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.person_role_label_anchor_v1(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.person_role_label_block_v1(uuid, uuid) TO service_role;