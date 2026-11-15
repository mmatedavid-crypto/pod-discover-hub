-- Owner 2026-11-15: extract value from data we already hold. Two deadlocks fixed:
-- 1) People with >=1 verified public episode stayed 'inactive' (hidden) because the only
--    activation path ran after a full extractor sweep that never completes. Owner rule
--    (1+ verified episode -> public, indexable, browsable) is now applied hourly.
-- 2) The role-label lane treated default 'inactive' as an identity flag, so a person's
--    explicit "Vendég:/Műsorvezető:" credit could never land.
CREATE OR REPLACE FUNCTION public.activate_people_with_verified_episodes_v1(_limit integer DEFAULT 20000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $fn$
DECLARE v_n integer;
BEGIN
  WITH v AS (
    SELECT DISTINCT person_id FROM public.person_public_episode_links_v1 WHERE verified
  ), c AS (
    SELECT pp.id FROM public.people pp JOIN v ON v.person_id = pp.id
    WHERE pp.activation_status = 'inactive'
      AND COALESCE(NULLIF(pp.activation_reason,''),'below_activation_thresholds') IN ('below_activation_thresholds','meets_public_threshold_only')
      AND COALESCE(pp.ai_recommended_action,'') NOT IN ('hide','reject')
      AND COALESCE(pp.ai_review_status,'') NOT IN ('needs_human_review','duplicate_candidate')
      AND COALESCE(pp.identity_status,'normal') IN ('normal','confirmed','context_resolved')
      AND NOT COALESCE(pp.identity_ambiguous,false)
      AND NOT COALESCE(pp.duplicate_candidate,false)
      AND NOT COALESCE(pp.needs_human_review_identity,false)
      AND NOT COALESCE(pp.is_topic_only,false)
    LIMIT GREATEST(1, LEAST(COALESCE(_limit, 20000), 50000))
  )
  UPDATE public.people pp
  SET activation_status = 'active',
      activation_reason = 'verified_episode_link',
      activated_at = COALESCE(pp.activated_at, now()),
      is_public = true,
      is_indexable = true,
      is_browsable_in_people_hub = true,
      updated_at = now()
  FROM c WHERE pp.id = c.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.activate_people_with_verified_episodes_v1(integer) FROM PUBLIC, anon, authenticated;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.activate_people_with_verified_episodes_v1(integer) FROM readonly_codex';
  END IF;
END $g$;
GRANT EXECUTE ON FUNCTION public.activate_people_with_verified_episodes_v1(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.person_role_label_block_v1(_person uuid, _episode uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN pe.id IS NULL OR e.id IS NULL THEN 'missing'
    WHEN p.language_decision IS DISTINCT FROM 'accept_hungarian' THEN 'not_hungarian_show'
    WHEN COALESCE(pe.identity_ambiguous,false) OR COALESCE(pe.duplicate_candidate,false) OR COALESCE(pe.needs_human_review_identity,false)
      OR COALESCE(pe.identity_status,'normal') NOT IN ('normal','confirmed','context_resolved')
      OR COALESCE(pe.ai_review_status,'') IN ('needs_human_review','duplicate_candidate')
      OR COALESCE(pe.ai_recommended_action,'') IN ('hide','reject')
      OR COALESCE(pe.activation_status,'') IN ('hidden','rejected')
      -- 'inactive' alone is the default "no page yet" state, not a quality verdict; only a
      -- recorded downgrade reason blocks (otherwise a first explicit credit could never land).
      OR (pe.activation_status = 'inactive' AND COALESCE(NULLIF(pe.activation_reason,''),'below_activation_thresholds')
          NOT IN ('below_activation_thresholds','meets_public_threshold_only')) THEN 'person_identity_flag'
    WHEN EXISTS (SELECT 1 FROM people o WHERE o.normalized_name = pe.normalized_name AND o.id <> pe.id
      AND COALESCE(o.identity_status,'') <> 'merged_into') THEN 'catalog_homonym'
    WHEN COALESCE(pe.is_historical,false) OR (pe.date_of_death IS NOT NULL AND pe.date_of_death < e.published_at::date)
      OR (pe.date_of_birth IS NOT NULL AND pe.date_of_birth < date '1900-01-01') THEN 'historical_person'
    WHEN EXISTS (SELECT 1 FROM person_episode_mentions m WHERE m.person_id = _person AND m.episode_id = _episode
      AND (m.relevance_status IN ('accepted','rejected','in_progress','resolved_show_host') OR COALESCE(m.validation_source,'') ~* 'manual|chatgpt|external_review'
           OR m.ai_identity_match IN ('different_person_same_name','substring_false_positive'))) THEN 'pair_decided_or_conflict'
    WHEN EXISTS (SELECT 1 FROM person_pair_dispositions d WHERE d.person_id = _person AND d.episode_id = _episode
      AND (d.disposition IN ('human_identity_review','human_contradiction_review','decided_rejected','decided_accepted','resolved_show_host') OR d.decided_by LIKE 'human:%')) THEN 'pair_review_state'
    WHEN EXISTS (SELECT 1 FROM person_relevance_work w JOIN person_relevance_batch_jobs j ON j.id = w.claim_token
      WHERE w.person_id = _person AND w.episode_id = _episode AND w.lease_until > now()
        AND j.status IN ('claimed','uploading','submitted','validating','in_progress','finalizing','cancelling','ingesting')) THEN 'open_batch_job'
  END
  FROM (SELECT 1) one
  LEFT JOIN people pe ON pe.id = _person
  LEFT JOIN episodes e ON e.id = _episode
  LEFT JOIN podcasts p ON p.id = e.podcast_id
$function$;
REVOKE ALL ON FUNCTION public.person_role_label_block_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.person_role_label_block_v1(uuid, uuid) TO service_role;

DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'person-activate-verified-hourly') THEN
    PERFORM cron.schedule('person-activate-verified-hourly', '29 * * * *',
      'SELECT public.activate_people_with_verified_episodes_v1(20000)');
  END IF;
END $c$;