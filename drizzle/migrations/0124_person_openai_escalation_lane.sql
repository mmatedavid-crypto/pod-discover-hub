-- Owner decision 2026-10-27: uncertain person–episode links already reviewed by the
-- primary model get a second, stronger AI review (separate $20 cap). Namesake /
-- substring matches are closed as rejected only when both AI reviews agree.
ALTER TABLE public.person_relevance_batch_items ADD COLUMN IF NOT EXISTS prior_item_id uuid;
CREATE INDEX IF NOT EXISTS idx_prb_items_tier_pair ON public.person_relevance_batch_items (tier, person_id, episode_id);

CREATE OR REPLACE FUNCTION public.claim_person_openai_escalation_pairs(_job uuid, _limit integer)
RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
DECLARE ctrl jsonb; r record; src jsonb; hash text; got integer;
BEGIN
  SELECT value INTO ctrl FROM app_settings WHERE key = 'person_relevance_openai_batch_controls';
  IF COALESCE((ctrl->>'enabled')::boolean, false) IS NOT TRUE OR COALESCE((ctrl->>'escalation_enabled')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'escalation_disabled'; END IF;
  IF EXISTS (SELECT 1 FROM app_settings WHERE key = 'background_jobs'
    AND (value->>'enabled' = 'false' OR value->>'incident_mode' = 'true')) THEN RAISE EXCEPTION 'background_jobs_paused'; END IF;
  IF NOT EXISTS (SELECT 1 FROM person_relevance_batch_jobs WHERE id = _job AND status = 'claimed' AND tier = 'escalation') THEN
    RAISE EXCEPTION 'job_not_claimable'; END IF;
  FOR r IN
    WITH latest AS (
      SELECT DISTINCT ON (i.person_id, i.episode_id) i.id, i.person_id, i.episode_id, i.source_hash, i.identity_risk,
        i.decision, i.final_status
      FROM person_relevance_batch_items i
      WHERE i.tier = 'primary' AND i.status = 'applied'
      ORDER BY i.person_id, i.episode_id, i.applied_at DESC NULLS LAST, i.created_at DESC
    ), cand AS (
      SELECT l.*, CASE WHEN l.decision->>'ai_suggested_status' = 'rejected'
          AND l.decision->>'identity_match' IN ('different_person_same_name','substring_false_positive') THEN 2 ELSE 1 END AS prio
      FROM latest l WHERE l.final_status = 'needs_review'
    )
    SELECT c.* FROM cand c
    WHERE NOT (c.identity_risk AND c.prio = 1)
      AND NOT EXISTS (SELECT 1 FROM person_relevance_batch_items e WHERE e.tier = 'escalation'
        AND e.person_id = c.person_id AND e.episode_id = c.episode_id AND e.status <> 'released')
      AND EXISTS (SELECT 1 FROM person_episode_mentions m WHERE m.person_id = c.person_id AND m.episode_id = c.episode_id
        AND m.relevance_status = 'needs_review' AND m.validation_source = 'person_openai_batch_v1')
      AND NOT EXISTS (SELECT 1 FROM person_episode_mentions x WHERE x.person_id = c.person_id AND x.episode_id = c.episode_id
        AND (x.relevance_status IN ('accepted','rejected','in_progress') OR COALESCE(x.validation_source,'') ~* 'manual|chatgpt|external_review'))
      AND NOT EXISTS (SELECT 1 FROM person_relevance_work w WHERE w.person_id = c.person_id AND w.episode_id = c.episode_id AND w.lease_until > now())
    ORDER BY c.prio, c.id
    LIMIT LEAST(GREATEST(COALESCE(_limit, 1), 1), 2000)
  LOOP
    src := public.person_judge_source(r.person_id, r.episode_id);
    IF src IS NULL THEN CONTINUE; END IF;
    hash := md5(src::text);
    -- Both reviews must see the same text, otherwise "two AI agree" is meaningless.
    IF hash IS DISTINCT FROM r.source_hash THEN CONTINUE; END IF;
    INSERT INTO person_relevance_work(person_id, episode_id, claim_token, lease_until, source_hash)
    VALUES (r.person_id, r.episode_id, _job, now() + interval '26 hours', hash)
    ON CONFLICT (person_id, episode_id) DO UPDATE SET claim_token = EXCLUDED.claim_token,
      lease_until = EXCLUDED.lease_until, source_hash = EXCLUDED.source_hash, updated_at = now()
    WHERE person_relevance_work.lease_until < now();
    GET DIAGNOSTICS got = ROW_COUNT;
    IF got = 1 THEN
      RETURN NEXT jsonb_build_object('person_id', r.person_id, 'episode_id', r.episode_id, 'source_hash', hash,
        'identity_risk', r.identity_risk, 'input', src, 'prior_item_id', r.id);
    END IF;
  END LOOP;
END;
$$;

-- Applies an escalation result. Same guards as apply_person_openai_batch_item, but it may
-- also update rows the primary batch left in needs_review. Rejection only when both AI
-- reviews independently say namesake / substring match with a quoted source.
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
    IF NOT (d->>'status' = 'rejected' AND d->>'identity_match' IN ('different_person_same_name','substring_false_positive')
      AND jsonb_array_length(COALESCE(d->'evidence_phrases','[]')) > 0
      AND pd->>'ai_suggested_status' = 'rejected' AND pd->>'identity_match' IN ('different_person_same_name','substring_false_positive'))
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
        WHEN final = 'rejected' THEN left('Két AI-ellenőrzés egyezően: névrokon vagy véletlen névegyezés. ' || coalesce(d->>'reason',''), 240)
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

-- Cost reservation with separate per-lane caps (primary vs escalation) on top of the
-- shared total/daily caps.
CREATE OR REPLACE FUNCTION public.reserve_person_openai_batch_cost(_job uuid, _amount numeric, _requests integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE ctrl jsonb; auth jsonb; total_cap numeric; daily_cap numeric; max_req integer;
  committed numeric; today numeric; used_req integer; v_tier text; lane_cap numeric; lane_committed numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('person_openai_batch_cost', 0));
  SELECT value INTO ctrl FROM app_settings WHERE key = 'person_relevance_openai_batch_controls';
  auth := ctrl->'authorized_pilot';
  IF COALESCE((ctrl->>'enabled')::boolean, false) IS NOT TRUE OR auth IS NULL OR jsonb_typeof(auth) <> 'object' THEN
    RAISE EXCEPTION 'no_authorized_pilot'; END IF;
  total_cap := LEAST(COALESCE((ctrl->>'total_cap_usd')::numeric, 0), COALESCE((auth->>'total_cap_usd')::numeric, 0));
  daily_cap := LEAST(COALESCE((ctrl->>'daily_cap_usd')::numeric, 0), COALESCE((auth->>'daily_cap_usd')::numeric, total_cap));
  max_req := COALESCE((auth->>'max_requests')::integer, 0);
  IF _amount IS NULL OR _amount <= 0 OR _requests IS NULL OR _requests <= 0 THEN RAISE EXCEPTION 'invalid_reservation'; END IF;
  SELECT tier INTO v_tier FROM person_relevance_batch_jobs WHERE id = _job;
  SELECT COALESCE(sum(GREATEST(reserved_cost_usd, actual_cost_usd)), 0),
         COALESCE(sum(GREATEST(reserved_cost_usd, actual_cost_usd)) FILTER (WHERE created_at >= date_trunc('day', now())), 0),
         COALESCE(sum(request_count), 0),
         COALESCE(sum(GREATEST(reserved_cost_usd, actual_cost_usd)) FILTER (WHERE tier = v_tier), 0)
    INTO committed, today, used_req, lane_committed
  FROM person_relevance_batch_jobs WHERE status NOT IN ('draft','aborted') AND id <> _job;
  lane_cap := CASE v_tier WHEN 'escalation' THEN (ctrl->>'escalation_total_cap_usd')::numeric
                          WHEN 'primary' THEN (ctrl->>'primary_total_cap_usd')::numeric ELSE NULL END;
  IF v_tier = 'escalation' AND COALESCE(lane_cap, 0) <= 0 THEN RAISE EXCEPTION 'escalation_cap_missing'; END IF;
  IF lane_cap IS NOT NULL AND lane_committed + _amount > lane_cap THEN RAISE EXCEPTION 'lane_cap_exceeded'; END IF;
  IF committed + _amount > total_cap THEN RAISE EXCEPTION 'total_cap_exceeded'; END IF;
  IF today + _amount > daily_cap THEN RAISE EXCEPTION 'daily_cap_exceeded'; END IF;
  IF used_req + _requests > max_req THEN RAISE EXCEPTION 'authorized_requests_exceeded'; END IF;
  UPDATE person_relevance_batch_jobs SET reserved_cost_usd = _amount, request_count = _requests, status = 'uploading', updated_at = now()
  WHERE id = _job AND status = 'claimed';
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_claimed'; END IF;
  RETURN jsonb_build_object('committed_usd', committed + _amount, 'today_usd', today + _amount, 'lane', v_tier,
    'lane_committed_usd', lane_committed + _amount, 'lane_cap_usd', lane_cap,
    'total_cap_usd', total_cap, 'daily_cap_usd', daily_cap, 'requests_used', used_req + _requests, 'max_requests', max_req);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_person_openai_escalation_pairs(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_person_openai_escalation_item(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_person_openai_batch_cost(uuid, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_person_openai_escalation_pairs(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_person_openai_escalation_item(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_person_openai_batch_cost(uuid, numeric, integer) TO service_role;