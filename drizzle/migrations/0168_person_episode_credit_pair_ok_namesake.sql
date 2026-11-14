CREATE OR REPLACE FUNCTION public.person_episode_credit_pair_ok_v1(_person uuid, _episode uuid, _outcome text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM person_episode_mentions m WHERE m.person_id = _person AND m.episode_id = _episode
      AND (m.relevance_status IN ('accepted','rejected') OR COALESCE(m.validation_source,'') ~* 'manual|chatgpt|external_review'
        OR (_outcome = 'credited_role' AND m.ai_identity_match IN ('different_person_same_name','substring_false_positive'))
        OR m.relevance_status NOT IN ('pending','needs_review','waiting_clean_text','in_progress','resolved_show_host')
        OR (_outcome = 'feed_credit_not_episode' AND (m.relevance_status = 'resolved_show_host' OR COALESCE(m.source,'') <> 'rss_author'))))
    AND NOT EXISTS (SELECT 1 FROM person_pair_dispositions d WHERE d.person_id = _person AND d.episode_id = _episode
      AND (d.disposition IN ('decided_accepted','decided_rejected','human_contradiction_review') OR COALESCE(d.decided_by,'') LIKE 'human:%'))
    AND NOT EXISTS (SELECT 1 FROM person_relevance_work w JOIN person_relevance_batch_jobs j ON j.id = w.claim_token
      WHERE w.person_id = _person AND w.episode_id = _episode AND w.lease_until > now()
        AND j.status IN ('claimed','uploading','submitted','validating','in_progress','finalizing','cancelling','ingesting','completed'))
$$;
REVOKE ALL ON FUNCTION public.person_episode_credit_pair_ok_v1(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
  REVOKE ALL ON FUNCTION public.person_episode_credit_pair_ok_v1(uuid, uuid, text) FROM readonly_codex; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.person_episode_credit_pair_ok_v1(uuid, uuid, text) TO service_role;