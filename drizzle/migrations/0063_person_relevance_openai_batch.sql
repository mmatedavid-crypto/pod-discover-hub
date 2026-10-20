-- OpenAI Batch orchestration for person-episode relevance review.
-- Disabled by default: nothing can be submitted until controls are explicitly
-- enabled with an authorized pilot cap. Admin/service only.

CREATE TABLE public.person_relevance_batch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier text NOT NULL DEFAULT 'primary' CHECK (tier IN ('primary','escalation','golden_eval')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','claimed','uploading','submitted','validating','in_progress',
    'finalizing','completed','failed','expired','cancelling','cancelled','ingesting','ingested','aborted','rolled_back')),
  model text NOT NULL,
  prompt_version text NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  input_bytes integer NOT NULL DEFAULT 0,
  reserved_cost_usd numeric NOT NULL DEFAULT 0 CHECK (reserved_cost_usd >= 0),
  actual_cost_usd numeric NOT NULL DEFAULT 0 CHECK (actual_cost_usd >= 0),
  openai_input_file_id text,
  openai_batch_id text UNIQUE,
  openai_output_file_id text,
  openai_error_file_id text,
  request_counts jsonb,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  ingested_at timestamptz,
  rolled_back_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_prb_jobs_status ON public.person_relevance_batch_jobs (status, created_at DESC);

CREATE TABLE public.person_relevance_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.person_relevance_batch_jobs(id) ON DELETE CASCADE,
  custom_id text NOT NULL UNIQUE,
  person_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  source_hash text NOT NULL,
  prompt_version text NOT NULL,
  tier text NOT NULL,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 5),
  identity_risk boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','submitted','succeeded','failed','expired','invalid',
    'refused','awaiting_escalation','escalated','applied','skipped_stale','skipped_protected','released','evaluated')),
  decision jsonb,
  final_status text CHECK (final_status IS NULL OR final_status IN ('accepted','rejected','needs_review','waiting_clean_text')),
  escalate boolean NOT NULL DEFAULT false,
  error text,
  input_tokens integer,
  cached_tokens integer,
  output_tokens integer,
  cost_usd numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);
CREATE INDEX idx_prb_items_job_status ON public.person_relevance_batch_items (job_id, status);
CREATE INDEX idx_prb_items_pair ON public.person_relevance_batch_items (person_id, episode_id);
CREATE INDEX idx_prb_items_status ON public.person_relevance_batch_items (status) WHERE status IN ('failed','expired','awaiting_escalation');

CREATE TABLE public.person_relevance_batch_audit (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL,
  item_id uuid NOT NULL,
  mention_id uuid NOT NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  rollback_note text
);
CREATE INDEX idx_prb_audit_job ON public.person_relevance_batch_audit (job_id) WHERE rolled_back_at IS NULL;

CREATE TABLE public.person_relevance_goldens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  source_hash text,
  label_status text NOT NULL CHECK (label_status IN ('accepted','rejected','needs_review')),
  label_mention_type text CHECK (label_mention_type IS NULL OR label_mention_type IN ('host','guest','subject','mentioned','none')),
  label_identity text CHECK (label_identity IS NULL OR label_identity IN ('same_person','different_person_same_name','substring_false_positive','uncertain')),
  stratum text,
  notes text,
  labeled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, episode_id)
);

GRANT ALL ON public.person_relevance_batch_jobs TO service_role;
GRANT ALL ON public.person_relevance_batch_items TO service_role;
GRANT ALL ON public.person_relevance_batch_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.person_relevance_batch_audit_id_seq TO service_role;
GRANT ALL ON public.person_relevance_goldens TO service_role;
GRANT SELECT ON public.person_relevance_batch_jobs TO authenticated;
GRANT SELECT ON public.person_relevance_goldens TO authenticated;

ALTER TABLE public.person_relevance_batch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_relevance_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_relevance_batch_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_relevance_goldens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read batch jobs" ON public.person_relevance_batch_jobs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins read goldens" ON public.person_relevance_goldens
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Read-only candidate selection shared by preview and claim. Protected pairs
-- (manual/ChatGPT/external review, any accepted/rejected/in-progress row) and
-- leased pairs are excluded entirely.
CREATE OR REPLACE FUNCTION public.person_openai_batch_candidates(_limit integer, _offset integer DEFAULT 0,
  _role text DEFAULT NULL, _person_ids uuid[] DEFAULT NULL)
RETURNS TABLE(person_id uuid, episode_id uuid, is_public_person boolean, published_at timestamptz, identity_risk boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH cand AS (
    SELECT m.person_id, m.episode_id,
      bool_or(person.is_public AND person.is_indexable) AS pub, max(e.published_at) AS pub_at
    FROM person_episode_mentions m
    JOIN people person ON person.id = m.person_id
    JOIN episodes e ON e.id = m.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE m.relevance_status = 'pending'
      AND p.language_decision = 'accept_hungarian'
      AND (_role IS NULL OR m.role_type = _role)
      AND (_person_ids IS NULL OR m.person_id = ANY(_person_ids))
    GROUP BY m.person_id, m.episode_id
  )
  SELECT c.person_id, c.episode_id, COALESCE(c.pub, false), c.pub_at,
    COALESCE(person.identity_ambiguous, false) OR EXISTS (
      SELECT 1 FROM people other WHERE other.normalized_name = person.normalized_name
        AND other.id <> person.id AND other.is_public) AS identity_risk
  FROM cand c
  JOIN people person ON person.id = c.person_id
  WHERE NOT EXISTS (
      SELECT 1 FROM person_episode_mentions x WHERE x.person_id = c.person_id AND x.episode_id = c.episode_id
        AND (x.relevance_status IN ('accepted','rejected','in_progress')
          OR COALESCE(x.validation_source, '') ~* 'manual|chatgpt|external_review'))
    AND NOT EXISTS (
      SELECT 1 FROM person_relevance_work w WHERE w.person_id = c.person_id AND w.episode_id = c.episode_id
        AND w.lease_until > now())
  ORDER BY c.pub DESC NULLS LAST, c.pub_at DESC NULLS LAST, c.person_id, c.episode_id
  LIMIT LEAST(GREATEST(COALESCE(_limit, 25), 1), 2000) OFFSET GREATEST(COALESCE(_offset, 0), 0)
$$;

-- Lease pairs for a submitted job. Lease covers the 24h batch window plus margin.
-- Requires enabled controls; returns the source used for the request.
CREATE OR REPLACE FUNCTION public.claim_person_openai_batch_pairs(_job uuid, _limit integer,
  _role text DEFAULT NULL, _person_ids uuid[] DEFAULT NULL)
RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
DECLARE ctrl jsonb; r record; src jsonb; hash text; got integer;
BEGIN
  SELECT value INTO ctrl FROM app_settings WHERE key = 'person_relevance_openai_batch_controls';
  IF COALESCE((ctrl->>'enabled')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'batch_controls_disabled'; END IF;
  IF EXISTS (SELECT 1 FROM app_settings WHERE key = 'background_jobs'
    AND (value->>'enabled' = 'false' OR value->>'incident_mode' = 'true')) THEN RAISE EXCEPTION 'background_jobs_paused'; END IF;
  IF NOT EXISTS (SELECT 1 FROM person_relevance_batch_jobs WHERE id = _job AND status = 'claimed') THEN
    RAISE EXCEPTION 'job_not_claimable'; END IF;
  FOR r IN SELECT * FROM public.person_openai_batch_candidates(
    LEAST(GREATEST(_limit, 1), COALESCE((ctrl->>'max_requests_per_job')::integer, 0), 2000), 0, _role, _person_ids)
  LOOP
    src := public.person_judge_source(r.person_id, r.episode_id);
    IF src IS NULL THEN CONTINUE; END IF;
    hash := md5(src::text);
    INSERT INTO person_relevance_work(person_id, episode_id, claim_token, lease_until, source_hash)
    VALUES (r.person_id, r.episode_id, _job, now() + interval '26 hours', hash)
    ON CONFLICT (person_id, episode_id) DO UPDATE SET claim_token = EXCLUDED.claim_token,
      lease_until = EXCLUDED.lease_until, source_hash = EXCLUDED.source_hash, updated_at = now()
    WHERE person_relevance_work.lease_until < now();
    GET DIAGNOSTICS got = ROW_COUNT;
    IF got = 1 THEN
      RETURN NEXT jsonb_build_object('person_id', r.person_id, 'episode_id', r.episode_id, 'source_hash', hash,
        'identity_risk', r.identity_risk, 'input', src);
    END IF;
  END LOOP;
END;
$$;

-- Release leases of a job's unapplied pairs (failure, expiry, cancel, abort).
CREATE OR REPLACE FUNCTION public.release_person_openai_batch_job(_job uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  UPDATE person_relevance_work SET lease_until = now(), updated_at = now()
  WHERE claim_token = _job AND lease_until > now();
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE person_relevance_batch_items SET status = 'released', updated_at = now()
  WHERE job_id = _job AND status IN ('queued','submitted');
  RETURN n;
END;
$$;

-- Atomic cost reservation against authorized pilot, daily and total caps.
CREATE OR REPLACE FUNCTION public.reserve_person_openai_batch_cost(_job uuid, _amount numeric, _requests integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ctrl jsonb; auth jsonb; total_cap numeric; daily_cap numeric; max_req integer;
  committed numeric; today numeric; used_req integer;
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
  SELECT COALESCE(sum(GREATEST(reserved_cost_usd, actual_cost_usd)), 0),
         COALESCE(sum(GREATEST(reserved_cost_usd, actual_cost_usd)) FILTER (WHERE created_at >= date_trunc('day', now())), 0),
         COALESCE(sum(request_count), 0)
    INTO committed, today, used_req
  FROM person_relevance_batch_jobs WHERE status NOT IN ('draft','aborted') AND id <> _job;
  IF committed + _amount > total_cap THEN RAISE EXCEPTION 'total_cap_exceeded'; END IF;
  IF today + _amount > daily_cap THEN RAISE EXCEPTION 'daily_cap_exceeded'; END IF;
  IF used_req + _requests > max_req THEN RAISE EXCEPTION 'authorized_requests_exceeded'; END IF;
  UPDATE person_relevance_batch_jobs SET reserved_cost_usd = _amount, request_count = _requests, status = 'uploading', updated_at = now()
  WHERE id = _job AND status = 'claimed';
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_claimed'; END IF;
  RETURN jsonb_build_object('committed_usd', committed + _amount, 'today_usd', today + _amount,
    'total_cap_usd', total_cap, 'daily_cap_usd', daily_cap, 'requests_used', used_req + _requests, 'max_requests', max_req);
END;
$$;

-- Apply one validated item. Only pending rows change; protected pairs, stale
-- sources or lost leases are skipped. Every changed row is audited for rollback.
CREATE OR REPLACE FUNCTION public.apply_person_openai_batch_item(_item uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE it person_relevance_batch_items; w person_relevance_work; d jsonb; final text; wanted text; role text;
  canonical uuid; m record; after_row jsonb; changed integer := 0; protected boolean;
BEGIN
  SELECT * INTO it FROM person_relevance_batch_items WHERE id = _item FOR UPDATE;
  IF NOT FOUND OR it.status <> 'succeeded' OR it.tier = 'golden_eval' THEN RAISE EXCEPTION 'item_not_applicable'; END IF;
  d := it.decision; final := it.final_status; wanted := d->>'mention_type';
  IF final NOT IN ('accepted','rejected','needs_review') OR wanted NOT IN ('host','guest','subject','mentioned','none')
    OR COALESCE((d->>'score')::numeric, -1) NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  IF final = 'accepted' AND (wanted = 'none' OR d->>'identity_match' IS DISTINCT FROM 'same_person'
    OR (d->>'score')::numeric < 0.85 OR jsonb_array_length(COALESCE(d->'evidence_phrases','[]')) = 0 OR it.identity_risk)
    THEN RAISE EXCEPTION 'unsafe_acceptance'; END IF;
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
      WHERE person_id = it.person_id AND episode_id = it.episode_id AND relevance_status = 'pending' AND mention_type = wanted
      ORDER BY id LIMIT 1;
    IF canonical IS NULL AND NOT EXISTS (SELECT 1 FROM person_episode_mentions
      WHERE person_id = it.person_id AND episode_id = it.episode_id AND mention_type = wanted) THEN
      SELECT id INTO canonical FROM person_episode_mentions
        WHERE person_id = it.person_id AND episode_id = it.episode_id AND relevance_status = 'pending' ORDER BY id LIMIT 1;
    END IF;
    IF canonical IS NULL THEN final := 'needs_review'; END IF;
  END IF;
  role := CASE wanted WHEN 'host' THEN 'participant' WHEN 'guest' THEN 'participant' WHEN 'subject' THEN 'subject' ELSE 'mention' END;
  FOR m IN SELECT * FROM person_episode_mentions WHERE person_id = it.person_id AND episode_id = it.episode_id
    AND relevance_status = 'pending' ORDER BY id LOOP
    UPDATE person_episode_mentions SET
      relevance_status = CASE WHEN final = 'accepted' AND id <> canonical THEN 'needs_review' ELSE final END,
      mention_type = CASE WHEN final = 'accepted' AND id = canonical THEN wanted ELSE mention_type END,
      role_type = CASE WHEN final = 'accepted' AND id = canonical THEN role ELSE role_type END,
      role_confidence = CASE WHEN final = 'accepted' AND id = canonical THEN (d->>'score')::numeric ELSE role_confidence END,
      role_reason = CASE WHEN final = 'accepted' AND id = canonical THEN d->>'reason' ELSE role_reason END,
      final_relevance_score = (d->>'score')::numeric,
      validation_source = 'person_openai_batch_v1',
      ai_identity_match = d->>'identity_match',
      ai_reason = CASE WHEN final = 'accepted' AND id <> canonical
        THEN 'Ismétlődő szerepsor; a kanonikus sor elfogadva, emberi ellenőrzésre vár.' ELSE left(d->>'reason', 240) END,
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

-- Restore audited rows of a job, only where the row still holds the batch value.
CREATE OR REPLACE FUNCTION public.rollback_person_openai_batch_job(_job uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE a record; cur person_episode_mentions; restored integer := 0; conflicts integer := 0;
BEGIN
  FOR a IN SELECT * FROM person_relevance_batch_audit WHERE job_id = _job AND rolled_back_at IS NULL ORDER BY id DESC LOOP
    SELECT * INTO cur FROM person_episode_mentions WHERE id = a.mention_id FOR UPDATE;
    IF NOT FOUND OR cur.relevance_status IS DISTINCT FROM a.after->>'relevance_status'
      OR cur.mention_type IS DISTINCT FROM a.after->>'mention_type'
      OR cur.validation_source IS DISTINCT FROM a.after->>'validation_source' THEN
      UPDATE person_relevance_batch_audit SET rollback_note = 'changed_after_batch' WHERE id = a.id;
      conflicts := conflicts + 1; CONTINUE;
    END IF;
    BEGIN
      UPDATE person_episode_mentions SET
        relevance_status = a.before->>'relevance_status', mention_type = a.before->>'mention_type',
        role_type = a.before->>'role_type', role_confidence = (a.before->>'role_confidence')::numeric,
        role_reason = a.before->>'role_reason', final_relevance_score = (a.before->>'final_relevance_score')::numeric,
        validation_source = a.before->>'validation_source', ai_identity_match = a.before->>'ai_identity_match',
        ai_reason = a.before->>'ai_reason',
        ai_evidence_phrases = CASE WHEN jsonb_typeof(a.before->'ai_evidence_phrases') = 'array'
          THEN ARRAY(SELECT jsonb_array_elements_text(a.before->'ai_evidence_phrases')) ELSE NULL END,
        ai_judged_at = (a.before->>'ai_judged_at')::timestamptz, ai_model = a.before->>'ai_model'
      WHERE id = a.mention_id;
      UPDATE person_relevance_batch_audit SET rolled_back_at = now(), rollback_note = 'restored' WHERE id = a.id;
      restored := restored + 1;
    EXCEPTION WHEN unique_violation THEN
      UPDATE person_relevance_batch_audit SET rollback_note = 'unique_conflict' WHERE id = a.id;
      conflicts := conflicts + 1;
    END;
  END LOOP;
  UPDATE person_relevance_batch_jobs SET status = CASE WHEN conflicts = 0 THEN 'rolled_back' ELSE status END,
    rolled_back_at = now(), updated_at = now() WHERE id = _job;
  RETURN jsonb_build_object('restored', restored, 'conflicts', conflicts);
END;
$$;

REVOKE ALL ON FUNCTION public.person_openai_batch_candidates(integer, integer, text, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_person_openai_batch_pairs(uuid, integer, text, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_person_openai_batch_job(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_person_openai_batch_cost(uuid, numeric, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_person_openai_batch_item(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rollback_person_openai_batch_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.person_openai_batch_candidates(integer, integer, text, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_person_openai_batch_pairs(uuid, integer, text, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_person_openai_batch_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_person_openai_batch_cost(uuid, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_person_openai_batch_item(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rollback_person_openai_batch_job(uuid) TO service_role;