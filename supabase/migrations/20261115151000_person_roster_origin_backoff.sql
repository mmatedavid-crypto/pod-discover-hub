-- Refine only proven non-active seven-day backoff and episode-specific host rules.
-- person-relevance-openai-batch parks inputGuard failures under random tokens for
-- seven days without creating a batch job. Keep these work rows exactly intact.
-- Genuine or unknown future claims remain protected. No decision is made here.
CREATE OR REPLACE FUNCTION public.repair_person_roster_origins_v1(_token uuid,_limit integer DEFAULT 5000,_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp SET statement_timeout='120s' AS $$
DECLARE lim integer:=least(greatest(coalesce(_limit,5000),1),5000); n integer; changed integer; rid uuid;
BEGIN
  PERFORM 1 FROM app_settings WHERE key='person_backlog_completion_controls'
    AND value->>'enabled'='true' AND value->>'run_token'=_token::text
    AND (value->>'lease_until')::timestamptz>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'owned completion lease required'; END IF;
  PERFORM 1 FROM app_settings WHERE key='background_jobs' AND value->>'enabled'='true'
    AND value->>'incident_mode'='false' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'background disabled'; END IF;
  DROP TABLE IF EXISTS pg_temp.roster_origin_targets;
  CREATE TEMP TABLE roster_origin_targets ON COMMIT DROP AS
  SELECT m.id,m.person_id,m.episode_id,p.hosts_source,to_jsonb(m) before_m,to_jsonb(d) before_d,(SELECT to_jsonb(w) FROM person_relevance_work w WHERE w.person_id=m.person_id AND w.episode_id=m.episode_id) before_w
  FROM person_episode_mentions m JOIN person_pair_dispositions d USING(person_id,episode_id)
  JOIN episodes e ON e.id=m.episode_id JOIN podcasts p ON p.id=e.podcast_id
  WHERE m.podcast_id=p.id AND m.source='rss_author' AND m.mention_type='host'
    AND p.hosts_source IN ('website_ai','ai_mentions')
    AND m.relevance_status IN ('pending','needs_review','waiting_clean_text')
    AND coalesce(m.validation_source,'') !~* 'human|manual|chatgpt|external_review'
    AND d.disposition NOT IN ('decided_accepted','decided_rejected','resolved_show_host','resolved_production_credit','human_contradiction_review','in_progress')
    AND coalesce(d.decided_by,'') !~* 'human|manual|chatgpt|external_review'
    AND NOT EXISTS(SELECT 1 FROM person_episode_mentions x WHERE x.person_id=m.person_id AND x.episode_id=m.episode_id
      AND (x.relevance_status IN ('accepted','rejected','resolved_show_host','resolved_production_credit','in_progress')
        OR coalesce(x.validation_source,'') ~* 'human|manual|chatgpt|external_review'))
    AND NOT EXISTS(SELECT 1 FROM person_relevance_work w WHERE w.person_id=m.person_id AND w.episode_id=m.episode_id AND w.lease_until>now()
      AND NOT (w.lease_until-w.updated_at BETWEEN interval '6 days 23 hours 59 minutes' AND interval '7 days 1 minute'
        AND NOT EXISTS(SELECT 1 FROM person_relevance_batch_jobs j WHERE j.id=w.claim_token)))
    AND NOT EXISTS(SELECT 1 FROM person_identity_merge_rules x WHERE x.source_person_id=m.person_id AND x.active)
    AND public.match_person_host_rule_v1(m.person_id,m.episode_id) IS NULL
  ORDER BY m.id LIMIT lim FOR UPDATE OF m,d SKIP LOCKED;
  SELECT count(*) INTO n FROM roster_origin_targets;
  IF _dry_run OR n=0 THEN RETURN jsonb_build_object('dry_run',_dry_run,'eligible_in_batch',n,'closed_pairs',0); END IF;
  PERFORM 1 FROM person_relevance_work w JOIN roster_origin_targets t USING(person_id,episode_id) FOR UPDATE OF w;
  IF EXISTS(SELECT 1 FROM roster_origin_targets t LEFT JOIN person_relevance_work w USING(person_id,episode_id) WHERE to_jsonb(w) IS DISTINCT FROM t.before_w)
    THEN RAISE EXCEPTION 'work claim changed during selection'; END IF;
  rid:=gen_random_uuid();
  INSERT INTO person_identity_repair_runs(id,version,summary) VALUES(rid,'roster-origin-repair-v2',jsonb_build_object('status','applying','run_token',_token,'target',n,'closed_pairs',0));
  INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT rid,'person_episode_mentions',before_m FROM roster_origin_targets;
  INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT rid,'person_pair_dispositions',before_d FROM roster_origin_targets;
  INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT rid,'person_relevance_work',before_w FROM roster_origin_targets WHERE before_w IS NOT NULL;
  UPDATE person_episode_mentions m SET source='podcast_host_list',source_evidence=coalesce(m.source_evidence,'{}'::jsonb)||jsonb_build_object('roster_provenance',jsonb_build_object(
    'scope','podcast','prior_source',m.source,'observed_hosts_source',t.hosts_source,'episode_participation_verified',false,
    'legacy_extractor','person-entity-extractor:9df341d0bd21469b96c75ecc519fed167d59d41e','repair_run',rid,
    'note','Legacy importer copied podcasts.hosts to every episode and hardcoded rss_author. Current show roster source is AI; historical source label is not episode evidence.'))
  FROM roster_origin_targets t WHERE m.id=t.id AND to_jsonb(m)=t.before_m;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>n THEN RAISE EXCEPTION 'roster repair CAS mismatch %/%',changed,n; END IF;
  IF EXISTS(SELECT 1 FROM roster_origin_targets t JOIN person_episode_mentions m ON m.id=t.id
    JOIN person_pair_dispositions d ON d.person_id=t.person_id AND d.episode_id=t.episode_id
    WHERE m.source IS DISTINCT FROM 'podcast_host_list' OR m.source_evidence#>>'{roster_provenance,repair_run}' IS DISTINCT FROM rid::text
      OR (to_jsonb(m)-'source'-'source_evidence') IS DISTINCT FROM (t.before_m-'source'-'source_evidence') OR to_jsonb(d) IS DISTINCT FROM t.before_d)
    THEN RAISE EXCEPTION 'roster repair attempted a decision or identity change'; END IF;
  IF EXISTS(SELECT 1 FROM roster_origin_targets t LEFT JOIN person_relevance_work w USING(person_id,episode_id) WHERE to_jsonb(w) IS DISTINCT FROM t.before_w)
    THEN RAISE EXCEPTION 'roster repair changed work/paid input state'; END IF;
  INSERT INTO person_pair_lane_audit(lane,action,person_id,episode_id,mention_id,rule_version,before_state,after_state,evidence)
    SELECT 'roster_origin','repair_provenance',t.person_id,t.episode_id,t.id,'roster-origin-repair-v2',t.before_m,to_jsonb(m),
      jsonb_build_object('repair_run',rid,'observed_hosts_source',t.hosts_source,'closed_pairs',0)
    FROM roster_origin_targets t JOIN person_episode_mentions m ON m.id=t.id;
  UPDATE person_identity_repair_runs SET completed_at=now(),summary=summary||jsonb_build_object('status','verified','updated_mentions',changed,'decision_changes',0,'closed_pairs',0) WHERE id=rid;
  RETURN jsonb_build_object('run_id',rid,'updated_mentions',changed,'decision_changes',0,'closed_pairs',0);
END $$;
REVOKE ALL ON FUNCTION public.repair_person_roster_origins_v1(uuid,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repair_person_roster_origins_v1(uuid,integer,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.undo_person_roster_origins_v1(_token uuid,_run uuid,_limit integer DEFAULT 5000)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp SET statement_timeout='120s' AS $$
DECLARE n integer; changed integer;
BEGIN
  PERFORM 1 FROM app_settings WHERE key='person_backlog_completion_controls' AND value->>'enabled'='true'
    AND value->>'run_token'=_token::text AND (value->>'lease_until')::timestamptz>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'owned completion lease required'; END IF;
  PERFORM 1 FROM app_settings WHERE key='background_jobs' AND value->>'enabled'='true' AND value->>'incident_mode'='false' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'background disabled'; END IF;
  DROP TABLE IF EXISTS pg_temp.roster_undo_targets;
  CREATE TEMP TABLE roster_undo_targets ON COMMIT DROP AS SELECT a.id aid,m.id mid,a.before_state,a.after_state,to_jsonb(d) before_d
    FROM person_pair_lane_audit a JOIN person_episode_mentions m ON m.id=a.mention_id
    JOIN person_pair_dispositions d ON d.person_id=m.person_id AND d.episode_id=m.episode_id
    WHERE a.lane='roster_origin' AND a.action='repair_provenance' AND a.evidence->>'repair_run'=_run::text AND a.undone_at IS NULL
      AND to_jsonb(m)=a.after_state
      AND NOT EXISTS(SELECT 1 FROM person_relevance_work w WHERE w.person_id=m.person_id AND w.episode_id=m.episode_id AND w.lease_until>now()
      AND NOT (w.lease_until-w.updated_at BETWEEN interval '6 days 23 hours 59 minutes' AND interval '7 days 1 minute'
        AND NOT EXISTS(SELECT 1 FROM person_relevance_batch_jobs j WHERE j.id=w.claim_token)))
    ORDER BY a.id LIMIT least(greatest(coalesce(_limit,5000),1),5000) FOR UPDATE OF a,m,d SKIP LOCKED;
  SELECT count(*) INTO n FROM roster_undo_targets;
  UPDATE person_episode_mentions m SET source=t.before_state->>'source',source_evidence=t.before_state->'source_evidence'
    FROM roster_undo_targets t WHERE m.id=t.mid AND to_jsonb(m)=t.after_state;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>n OR EXISTS(SELECT 1 FROM roster_undo_targets t JOIN person_episode_mentions m ON m.id=t.mid
    JOIN person_pair_dispositions d ON d.person_id=m.person_id AND d.episode_id=m.episode_id
    WHERE to_jsonb(m) IS DISTINCT FROM t.before_state OR to_jsonb(d) IS DISTINCT FROM t.before_d)
    THEN RAISE EXCEPTION 'undo would overwrite a later decision'; END IF;
  UPDATE person_pair_lane_audit a SET undone_at=now(),undone_by='deterministic:roster-origin-undo-v1' FROM roster_undo_targets t WHERE a.id=t.aid;
  RETURN jsonb_build_object('restored_mentions',changed,'closed_pairs',0);
END $$;
REVOKE ALL ON FUNCTION public.undo_person_roster_origins_v1(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.undo_person_roster_origins_v1(uuid,uuid,integer) TO service_role;

