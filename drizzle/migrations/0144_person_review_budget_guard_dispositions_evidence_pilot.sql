-- Person-review redesign, stage 1 (owner request 2026-11-14):
-- (1) one fail-closed budget guard for every external OpenAI cost (owner grant: $100 new spend,
--     $5 evidence pilot, the rest only after a recorded quality gate; old lanes keep their old caps),
-- (2) a separate, reversible pair-disposition layer (public mention statuses are not touched),
-- (3) shadow-only evidence-pack pilot tables (results never change public links).

-- ---------- 1. Central external-AI budget ----------
CREATE TABLE public.external_ai_budget_grants (
  id text PRIMARY KEY,
  provider text NOT NULL,
  total_cap_usd numeric NOT NULL CHECK (total_cap_usd >= 0),
  pilot_cap_usd numeric NOT NULL CHECK (pilot_cap_usd >= 0),
  legacy_cap_usd numeric NOT NULL CHECK (legacy_cap_usd >= 0),
  account_ceiling_usd numeric NOT NULL CHECK (account_ceiling_usd >= 0),
  daily_cap_usd numeric NOT NULL CHECK (daily_cap_usd >= 0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','closed')),
  paused_reason text,
  granted_by text NOT NULL,
  baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.external_ai_budget_grants TO authenticated;
GRANT ALL ON public.external_ai_budget_grants TO service_role;
ALTER TABLE public.external_ai_budget_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read budget grants" ON public.external_ai_budget_grants FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.external_ai_budget_ledger (
  ref text PRIMARY KEY,
  grant_id text NOT NULL REFERENCES public.external_ai_budget_grants(id),
  lane text NOT NULL CHECK (lane IN ('legacy','evidence_pilot','evidence_bulk')),
  reserved_usd numeric NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  actual_usd numeric,
  status text NOT NULL CHECK (status IN ('reserved','settled','released')),
  carryover boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX external_ai_budget_ledger_grant_idx ON public.external_ai_budget_ledger (grant_id, status);
GRANT SELECT ON public.external_ai_budget_ledger TO authenticated;
GRANT ALL ON public.external_ai_budget_ledger TO service_role;
ALTER TABLE public.external_ai_budget_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read budget ledger" ON public.external_ai_budget_ledger FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ---------- 3a. Evidence pilot tables (needed by the guard's gate check) ----------
CREATE TABLE public.person_evidence_gate_runs (
  id bigserial PRIMARY KEY,
  policy_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('shadow','insufficient_references','passed','failed')),
  passed_models text[] NOT NULL DEFAULT '{}',
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.person_evidence_gate_runs TO service_role;
GRANT USAGE ON SEQUENCE public.person_evidence_gate_runs_id_seq TO service_role;
ALTER TABLE public.person_evidence_gate_runs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.external_ai_budget_charge_v1(_ref text, _lane text, _amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE g public.external_ai_budget_grants; all_c numeric; legacy_c numeric; new_c numeric; pilot_c numeric; today_c numeric; gate text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('external_ai_budget', 0));
  IF _ref IS NULL OR _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'invalid_budget_charge'; END IF;
  IF _lane IS NULL OR _lane NOT IN ('legacy','evidence_pilot','evidence_bulk') THEN RAISE EXCEPTION 'unknown_budget_lane'; END IF;
  SELECT * INTO g FROM external_ai_budget_grants
   WHERE provider = 'openai' AND status = 'active' AND now() >= starts_at AND now() < expires_at
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_active_external_ai_grant'; END IF;
  SELECT COALESCE(sum(c),0),
         COALESCE(sum(c) FILTER (WHERE lane = 'legacy' AND NOT carryover),0),
         COALESCE(sum(c) FILTER (WHERE lane IN ('evidence_pilot','evidence_bulk')),0),
         COALESCE(sum(c) FILTER (WHERE lane = 'evidence_pilot'),0),
         COALESCE(sum(c) FILTER (WHERE NOT carryover AND created_at >= date_trunc('day', now())),0)
    INTO all_c, legacy_c, new_c, pilot_c, today_c
  FROM (SELECT lane, carryover, created_at, GREATEST(reserved_usd, COALESCE(actual_usd,0)) c
          FROM external_ai_budget_ledger WHERE grant_id = g.id AND status <> 'released' AND ref <> _ref) x;
  IF all_c + _amount > g.account_ceiling_usd THEN RAISE EXCEPTION 'external_ai_account_ceiling_exceeded'; END IF;
  IF today_c + _amount > g.daily_cap_usd THEN RAISE EXCEPTION 'external_ai_daily_cap_exceeded'; END IF;
  IF _lane = 'legacy' AND legacy_c + _amount > g.legacy_cap_usd THEN RAISE EXCEPTION 'legacy_authorization_exhausted'; END IF;
  IF _lane IN ('evidence_pilot','evidence_bulk') THEN
    SELECT status INTO gate FROM person_evidence_gate_runs ORDER BY id DESC LIMIT 1;
    IF gate = 'failed' THEN RAISE EXCEPTION 'evidence_quality_gate_failed'; END IF;
    IF new_c + _amount > g.total_cap_usd THEN RAISE EXCEPTION 'external_ai_total_cap_exceeded'; END IF;
    IF _lane = 'evidence_pilot' AND pilot_c + _amount > g.pilot_cap_usd THEN RAISE EXCEPTION 'evidence_pilot_cap_exceeded'; END IF;
    IF _lane = 'evidence_bulk' AND gate IS DISTINCT FROM 'passed' THEN RAISE EXCEPTION 'evidence_quality_gate_not_passed'; END IF;
  END IF;
  INSERT INTO external_ai_budget_ledger (ref, grant_id, lane, reserved_usd, status)
  VALUES (_ref, g.id, _lane, _amount, 'reserved')
  ON CONFLICT (ref) DO UPDATE SET reserved_usd = EXCLUDED.reserved_usd, lane = EXCLUDED.lane, status = 'reserved', updated_at = now();
  RETURN jsonb_build_object('grant_id', g.id, 'lane', _lane, 'amount_usd', _amount,
    'committed_all_usd', all_c + _amount, 'committed_new_usd', new_c + CASE WHEN _lane <> 'legacy' THEN _amount ELSE 0 END,
    'today_usd', today_c + _amount);
END $$;

-- Every job table that reserves external AI money goes through the guard inside the same
-- transaction as its reservation, so an over-cap reservation fails before anything is uploaded.
CREATE OR REPLACE FUNCTION public.external_ai_budget_job_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ref text := TG_ARGV[0] || ':' || NEW.id::text; v_lane text;
  amt numeric := COALESCE(NEW.reserved_cost_usd, 0); act numeric := COALESCE(NEW.actual_cost_usd, 0);
BEGIN
  v_lane := CASE WHEN TG_ARGV[1] = '@lane' THEN to_jsonb(NEW)->>'lane' ELSE TG_ARGV[1] END;
  IF NEW.status = 'aborted' THEN
    UPDATE external_ai_budget_ledger SET status = 'released', reserved_usd = 0, actual_usd = act, updated_at = now()
     WHERE ref = v_ref AND status <> 'released';
    RETURN NEW;
  END IF;
  IF NEW.status IN ('ingested','rolled_back') THEN
    UPDATE external_ai_budget_ledger SET status = 'settled', actual_usd = act, reserved_usd = act, updated_at = now() WHERE ref = v_ref;
    RETURN NEW;
  END IF;
  IF amt > 0 AND (TG_OP = 'INSERT' OR amt IS DISTINCT FROM COALESCE(OLD.reserved_cost_usd, 0)) THEN
    IF EXISTS (SELECT 1 FROM external_ai_budget_ledger WHERE ref = v_ref AND carryover) THEN
      UPDATE external_ai_budget_ledger SET reserved_usd = amt, updated_at = now() WHERE ref = v_ref;
    ELSE
      PERFORM public.external_ai_budget_charge_v1(v_ref, v_lane, amt);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER person_relevance_batch_jobs_budget BEFORE INSERT OR UPDATE ON public.person_relevance_batch_jobs
  FOR EACH ROW EXECUTE FUNCTION public.external_ai_budget_job_sync('person_job', 'legacy');
CREATE TRIGGER entity_description_jobs_budget BEFORE INSERT OR UPDATE ON public.entity_description_jobs
  FOR EACH ROW EXECUTE FUNCTION public.external_ai_budget_job_sync('entity_description_job', 'legacy');

-- Owner grant + baseline snapshot + carry-over of reservations that were open at grant time.
DO $g$
DECLARE ctrl jsonb; prim numeric; esc numeric; tot numeric; legacy numeric; base jsonb;
BEGIN
  SELECT value INTO ctrl FROM app_settings WHERE key = 'person_relevance_openai_batch_controls';
  SELECT COALESCE(sum(GREATEST(reserved_cost_usd, COALESCE(actual_cost_usd,0))) FILTER (WHERE tier = 'primary'),0),
         COALESCE(sum(GREATEST(reserved_cost_usd, COALESCE(actual_cost_usd,0))) FILTER (WHERE tier = 'escalation'),0),
         COALESCE(sum(GREATEST(reserved_cost_usd, COALESCE(actual_cost_usd,0))),0)
    INTO prim, esc, tot FROM person_relevance_batch_jobs WHERE status NOT IN ('draft','aborted');
  legacy := GREATEST(0, LEAST(
    GREATEST(0, COALESCE((ctrl->>'primary_total_cap_usd')::numeric,0) - prim) + GREATEST(0, COALESCE((ctrl->>'escalation_total_cap_usd')::numeric,0) - esc),
    COALESCE((ctrl->>'total_cap_usd')::numeric,0) - tot));
  base := jsonb_build_object(
    'snapshot_at', now(),
    'person_actual_usd_by_tier', (SELECT jsonb_object_agg(tier, a) FROM (SELECT tier, round(sum(COALESCE(actual_cost_usd,0))::numeric, 6) a
        FROM person_relevance_batch_jobs WHERE status = 'ingested' GROUP BY tier) x),
    'person_open_reservations_usd', (SELECT round(COALESCE(sum(reserved_cost_usd),0)::numeric, 6) FROM person_relevance_batch_jobs
        WHERE status NOT IN ('draft','aborted','ingested')),
    'person_open_jobs', (SELECT count(*) FROM person_relevance_batch_jobs WHERE status NOT IN ('draft','aborted','ingested')),
    'entity_description_actual_usd', (SELECT round(COALESCE(sum(actual_cost_usd),0)::numeric, 6) FROM entity_description_jobs WHERE status = 'ingested'),
    'old_caps', jsonb_build_object('primary', ctrl->'primary_total_cap_usd', 'escalation', ctrl->'escalation_total_cap_usd',
        'total', ctrl->'total_cap_usd', 'daily', ctrl->'daily_cap_usd'),
    'old_committed_usd', jsonb_build_object('primary', round(prim, 6), 'escalation', round(esc, 6), 'total', round(tot, 6)),
    'owner_reported_balance_usd', 112.83, 'owner_reported_expiring_usd', 105, 'owner_reported_expiry', '2026-11-30',
    'balance_verified_via_api', false,
    'note', 'Balance is the owner screenshot value; the OpenAI API key cannot read the account balance.');
  INSERT INTO external_ai_budget_grants (id, provider, total_cap_usd, pilot_cap_usd, legacy_cap_usd, account_ceiling_usd, daily_cap_usd,
    expires_at, granted_by, baseline)
  VALUES ('openai_owner_2026_11_14', 'openai', 100, 5, round(legacy, 6), 112.83, 10, '2026-11-30T00:00:00Z',
    'Máté David (chat 2026-11-14 13:42 UTC)', base);
  INSERT INTO external_ai_budget_ledger (ref, grant_id, lane, reserved_usd, actual_usd, status, carryover)
  SELECT 'person_job:' || id, 'openai_owner_2026_11_14', 'legacy', COALESCE(reserved_cost_usd,0), NULL, 'reserved', true
    FROM person_relevance_batch_jobs WHERE status NOT IN ('draft','aborted','ingested') AND COALESCE(reserved_cost_usd,0) > 0;
END $g$;

-- ---------- 2. Pair disposition layer ----------
CREATE TABLE public.person_pair_dispositions (
  person_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('decided_accepted','decided_rejected','first_round_pending','in_progress',
    'technical_retry','source_needed','insufficient_evidence','evidence_pending','human_identity_review','human_contradiction_review','other')),
  reason_code text NOT NULL,
  source_fingerprint text,
  policy_version text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by text NOT NULL,
  reopen_on_source_change boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, episode_id)
);
CREATE INDEX person_pair_dispositions_disp_idx ON public.person_pair_dispositions (disposition, reason_code);
GRANT ALL ON public.person_pair_dispositions TO service_role;
ALTER TABLE public.person_pair_dispositions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.person_pair_disposition_log (
  id bigserial PRIMARY KEY,
  person_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  old jsonb NOT NULL,
  new jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX person_pair_disposition_log_pair_idx ON public.person_pair_disposition_log (person_id, episode_id);
GRANT ALL ON public.person_pair_disposition_log TO service_role;
GRANT USAGE ON SEQUENCE public.person_pair_disposition_log_id_seq TO service_role;
ALTER TABLE public.person_pair_disposition_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.person_pair_disposition_log_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO person_pair_disposition_log (person_id, episode_id, old, new)
  VALUES (NEW.person_id, NEW.episode_id,
    jsonb_build_object('disposition', OLD.disposition, 'reason_code', OLD.reason_code, 'source_fingerprint', OLD.source_fingerprint, 'decided_by', OLD.decided_by, 'detail', OLD.detail),
    jsonb_build_object('disposition', NEW.disposition, 'reason_code', NEW.reason_code, 'source_fingerprint', NEW.source_fingerprint, 'decided_by', NEW.decided_by));
  RETURN NEW;
END $$;
CREATE TRIGGER person_pair_dispositions_log AFTER UPDATE ON public.person_pair_dispositions
  FOR EACH ROW WHEN (OLD.disposition IS DISTINCT FROM NEW.disposition OR OLD.reason_code IS DISTINCT FROM NEW.reason_code
    OR OLD.decided_by IS DISTINCT FROM NEW.decided_by)
  EXECUTE FUNCTION public.person_pair_disposition_log_trg();

-- Deterministic classification of HU person–episode pairs. Reads only; writes only this layer.
-- Name search is permissive (substring, Hungarian a/e lengthening), so "insufficient_evidence"
-- is only recorded when neither the full name nor an approved in-scope alias occurs in any
-- available source (title, RSS description, summary, full clean text, existing transcript).
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
      bool_or(m.ai_identity_match IN ('different_person_same_name','substring_false_positive')) namesake
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
          SELECT lower(person.name) n UNION ALL
          SELECT lower(a.alias) FROM person_aliases a WHERE a.person_id = pr.person_id AND a.status = 'accepted'
            AND (a.scope = 'global' OR (a.scope = 'podcast' AND a.scope_podcast_id = e.podcast_id) OR (a.scope = 'episode' AND a.scope_episode_id = e.id))
        ) s CROSS JOIN LATERAL (VALUES (s.n), (regexp_replace(s.n, 'a$', 'á')), (regexp_replace(s.n, 'e$', 'é'))) vv(v)
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
        WHEN nr AND idrisk THEN 'human_identity_review|same_name_or_ambiguous_person'
        WHEN nr AND ((psug = 'accepted' AND esug = 'rejected') OR (psug = 'rejected' AND esug = 'accepted')) THEN 'human_contradiction_review|ai_opinions_conflict'
        WHEN nr AND last_item IN ('failed','invalid','refused','expired') AND psug IS NULL AND esug IS NULL THEN 'technical_retry|last_request_failed'
        WHEN nr AND cleaned_text IS NULL AND transcript IS NULL AND length(COALESCE(description,'') || COALESCE(summary,'')) < 200 THEN 'source_needed|no_usable_source_text'
        WHEN nr AND NOT EXISTS (SELECT 1 FROM unnest(names) n WHERE position(n IN lower(concat_ws(' ', title, description, summary, cleaned_text, transcript))) > 0)
          THEN 'insufficient_evidence|name_not_in_available_sources'
        WHEN nr THEN 'evidence_pending|needs_targeted_evidence'
        ELSE 'other|unclassified_state' END dr,
      md5(concat_ws('|', 'pair-disposition-v1', array_to_string(names, ','), md5(COALESCE(title,'')), md5(COALESCE(description,'')),
        md5(COALESCE(summary,'')), md5(COALESCE(cleaned_text,'')), COALESCE(content_hash, md5(COALESCE(transcript,''))))) fp,
      jsonb_strip_nulls(jsonb_build_object('rows', nrows, 'dup_rows', CASE WHEN acc THEN nr_rows END,
        'after_escalation', NULLIF(esc, false), 'missing_disambiguation', CASE WHEN disambiguation_label IS NULL AND disambiguation_context IS NULL THEN true END,
        'long_text', CASE WHEN length(cleaned_text) > 6000 THEN true END, 'no_clean_text', CASE WHEN cleaned_text IS NULL THEN true END,
        'has_transcript', CASE WHEN transcript IS NOT NULL THEN true END, 'primary_suggested', psug, 'escalation_suggested', esug,
        'namesake_suggested', NULLIF(namesake, false))) detail
    FROM x)
  INSERT INTO person_pair_dispositions AS d (person_id, episode_id, disposition, reason_code, source_fingerprint, policy_version, detail, decided_by)
  SELECT person_id, episode_id, split_part(dr, '|', 1), split_part(dr, '|', 2), fp, 'pair-disposition-v1', detail, 'deterministic:pair-disposition-v1'
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

CREATE OR REPLACE FUNCTION public.person_pair_dispositions_tick_v1(_limit integer DEFAULT 10000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '170s' AS $$
DECLARE cur jsonb; r jsonb; lim integer := LEAST(GREATEST(COALESCE(_limit, 10000), 100), 20000); wrapped boolean;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('person_pair_dispositions_tick', 0)) THEN
    RETURN jsonb_build_object('skipped', 'locked'); END IF;
  SELECT value INTO cur FROM app_settings WHERE key = 'person_pair_disposition_cursor';
  cur := COALESCE(cur, '{}'::jsonb);
  r := public.classify_person_pair_dispositions_v1(NULLIF(cur->>'after_person','')::uuid, NULLIF(cur->>'after_episode','')::uuid, lim);
  wrapped := (r->>'scanned')::integer < lim;
  cur := cur || jsonb_build_object('after_person', CASE WHEN wrapped THEN NULL ELSE r->>'last_person' END,
    'after_episode', CASE WHEN wrapped THEN NULL ELSE r->>'last_episode' END,
    'last_run_at', now(), 'last_result', r,
    'passes_completed', COALESCE((cur->>'passes_completed')::integer, 0) + CASE WHEN wrapped THEN 1 ELSE 0 END)
    || CASE WHEN wrapped THEN jsonb_build_object('last_pass_completed_at', now()) ELSE '{}'::jsonb END;
  INSERT INTO app_settings (key, value, updated_at) VALUES ('person_pair_disposition_cursor', cur, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN cur;
END $$;

-- ---------- 3b. Evidence-pack shadow pilot ----------
CREATE TABLE public.person_evidence_sample (
  policy_version text NOT NULL,
  person_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  stratum text NOT NULL,
  rank integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_version, person_id, episode_id)
);
GRANT ALL ON public.person_evidence_sample TO service_role;
ALTER TABLE public.person_evidence_sample ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.person_evidence_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  policy_version text NOT NULL,
  fingerprint text NOT NULL,
  stratum text,
  identity_risk boolean NOT NULL DEFAULT false,
  precheck text,
  pack jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, episode_id, policy_version, fingerprint)
);
GRANT ALL ON public.person_evidence_packs TO service_role;
ALTER TABLE public.person_evidence_packs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.person_evidence_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lane text NOT NULL CHECK (lane IN ('evidence_pilot','evidence_bulk')),
  status text NOT NULL DEFAULT 'claimed',
  model text NOT NULL,
  policy_version text NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  reserved_cost_usd numeric NOT NULL DEFAULT 0,
  actual_cost_usd numeric NOT NULL DEFAULT 0,
  openai_input_file_id text, openai_batch_id text, openai_output_file_id text, openai_error_file_id text,
  request_counts jsonb, last_error text,
  lease_token uuid, lease_until timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz, completed_at timestamptz, ingested_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.person_evidence_jobs TO service_role;
ALTER TABLE public.person_evidence_jobs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER person_evidence_jobs_budget BEFORE INSERT OR UPDATE ON public.person_evidence_jobs
  FOR EACH ROW EXECUTE FUNCTION public.external_ai_budget_job_sync('evidence_job', '@lane');

CREATE TABLE public.person_evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id uuid NOT NULL REFERENCES public.person_evidence_packs(id),
  job_id uuid REFERENCES public.person_evidence_jobs(id),
  model text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  custom_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','submitted','succeeded','invalid','refused','failed','expired','released')),
  decision jsonb, verdict text,
  input_tokens integer, cached_tokens integer, output_tokens integer, cost_usd numeric NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, model, attempt)
);
CREATE INDEX person_evidence_items_job_idx ON public.person_evidence_items (job_id, status);
GRANT ALL ON public.person_evidence_items TO service_role;
ALTER TABLE public.person_evidence_items ENABLE ROW LEVEL SECURITY;

-- Human reference labels only (labeled_by is the admin's user id; AI output is never a reference).
CREATE TABLE public.person_evidence_references (
  person_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  label_role text NOT NULL CHECK (label_role IN ('host','co_host','guest','subject','mentioned','credit_only','not_present','different_person','cannot_tell')),
  labeled_by uuid NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, episode_id)
);
GRANT ALL ON public.person_evidence_references TO service_role;
ALTER TABLE public.person_evidence_references ENABLE ROW LEVEL SECURITY;

-- Full private source for building an evidence pack (service role only; never public).
CREATE OR REPLACE FUNCTION public.person_evidence_source_v1(_person uuid, _episode uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'person', jsonb_build_object('id', person.id, 'name', person.name, 'disambiguation_label', person.disambiguation_label,
      'disambiguation_context', left(person.disambiguation_context, 600),
      'identity_risk', COALESCE(person.identity_ambiguous, false) OR EXISTS (SELECT 1 FROM people o WHERE o.normalized_name = person.normalized_name
         AND o.id <> person.id AND o.is_public)),
    'aliases', COALESCE((SELECT jsonb_agg(jsonb_build_object('alias', a.alias, 'status', a.status, 'scope', a.scope,
        'scope_podcast_id', a.scope_podcast_id, 'scope_episode_id', a.scope_episode_id) ORDER BY a.alias) FROM person_aliases a WHERE a.person_id = _person), '[]'::jsonb),
    'episode', jsonb_build_object('id', e.id, 'podcast_id', e.podcast_id, 'title', e.title, 'description', left(COALESCE(e.description,''), 40000),
      'summary', left(COALESCE(e.summary,''), 4000), 'published_at', e.published_at),
    'podcast', jsonb_build_object('title', p.title, 'description', left(COALESCE(p.description,''), 4000)),
    'clean_text', (SELECT jsonb_build_object('text', left(ct.cleaned_text, 80000), 'method', ct.cleaner_method, 'quality_status', ct.quality_status)
        FROM episode_clean_text ct WHERE ct.episode_id = e.id AND ct.cleaner_method LIKE 'deterministic_v4%'),
    'transcript', (SELECT jsonb_build_object('text', left(t.transcript, 80000), 'source', t.source, 'rights_status', t.rights_status)
        FROM episode_transcripts t WHERE t.episode_id = e.id AND t.status = 'ok' ORDER BY length(t.transcript) DESC LIMIT 1),
    'external', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'source_type', s.source_type, 'domain', s.source_domain,
        'text', left(s.scraped_text, 20000), 'scope', CASE WHEN s.episode_id = e.id THEN 'episode' ELSE 'podcast' END))
        FROM person_external_sources s WHERE s.person_id = _person AND s.status = 'verified' AND s.scraped_text IS NOT NULL
          AND (s.episode_id = e.id OR (s.episode_id IS NULL AND s.podcast_id = e.podcast_id))), '[]'::jsonb),
    'mentions', COALESCE((SELECT jsonb_agg(jsonb_build_object('mention_type', m.mention_type, 'role_type', m.role_type,
        'relevance_status', m.relevance_status, 'evidence', left(m.evidence, 300)) ORDER BY m.id)
        FROM person_episode_mentions m WHERE m.person_id = _person AND m.episode_id = _episode), '[]'::jsonb))
  FROM people person CROSS JOIN episodes e JOIN podcasts p ON p.id = e.podcast_id
  WHERE person.id = _person AND e.id = _episode;
$$;

-- Deterministic, stratified pilot sample (idempotent per policy version).
CREATE OR REPLACE FUNCTION public.person_evidence_pilot_select_v1(_policy text, _seed text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM person_evidence_sample WHERE policy_version = _policy) THEN
    INSERT INTO person_evidence_sample (policy_version, person_id, episode_id, stratum, rank)
    SELECT _policy, person_id, episode_id, stratum, row_number() OVER (PARTITION BY stratum ORDER BY h)
    FROM (
      SELECT DISTINCT ON (person_id, episode_id) person_id, episode_id, stratum, h FROM (
        SELECT g.person_id, g.episode_id, 'golden_reference' stratum, 0 prio, md5(g.person_id::text || g.episode_id::text || _seed) h FROM person_relevance_goldens g
        UNION ALL (SELECT d.person_id, d.episode_id, 'after_escalation', 1, md5(d.person_id::text || d.episode_id::text || _seed) h FROM person_pair_dispositions d
          WHERE d.disposition = 'evidence_pending' AND d.detail ? 'after_escalation' ORDER BY h LIMIT 150)
        UNION ALL (SELECT d.person_id, d.episode_id, 'missing_disambiguation', 2, md5(d.person_id::text || d.episode_id::text || _seed) h FROM person_pair_dispositions d
          WHERE d.disposition = 'evidence_pending' AND d.detail ? 'missing_disambiguation' AND NOT d.detail ? 'after_escalation' ORDER BY h LIMIT 100)
        UNION ALL (SELECT d.person_id, d.episode_id, 'long_text', 3, md5(d.person_id::text || d.episode_id::text || _seed) h FROM person_pair_dispositions d
          WHERE d.disposition = 'evidence_pending' AND d.detail ? 'long_text' ORDER BY h LIMIT 60)
        UNION ALL (SELECT d.person_id, d.episode_id, 'namesake_suggested', 4, md5(d.person_id::text || d.episode_id::text || _seed) h FROM person_pair_dispositions d
          WHERE d.disposition = 'evidence_pending' AND d.detail ? 'namesake_suggested' ORDER BY h LIMIT 40)
        UNION ALL (SELECT d.person_id, d.episode_id, 'primary_only', 5, md5(d.person_id::text || d.episode_id::text || _seed) h FROM person_pair_dispositions d
          WHERE d.disposition = 'evidence_pending' AND NOT d.detail ? 'after_escalation' ORDER BY h LIMIT 230)
        UNION ALL (SELECT d.person_id, d.episode_id, 'identity_risk', 6, md5(d.person_id::text || d.episode_id::text || _seed) h FROM person_pair_dispositions d
          WHERE d.disposition = 'human_identity_review' ORDER BY h LIMIT 60)
        UNION ALL (SELECT d.person_id, d.episode_id, 'contradiction', 7, md5(d.person_id::text || d.episode_id::text || _seed) h FROM person_pair_dispositions d
          WHERE d.disposition = 'human_contradiction_review' ORDER BY h LIMIT 30)
        UNION ALL (SELECT d.person_id, d.episode_id, 'accepted_control', 8, md5(d.person_id::text || d.episode_id::text || _seed) h FROM person_pair_dispositions d
          WHERE d.disposition = 'decided_accepted' ORDER BY h LIMIT 60)
        UNION ALL (SELECT d.person_id, d.episode_id, 'rejected_control', 9, md5(d.person_id::text || d.episode_id::text || _seed) h FROM person_pair_dispositions d
          WHERE d.disposition = 'decided_rejected' ORDER BY h LIMIT 40)
      ) u ORDER BY person_id, episode_id, prio
    ) s;
  END IF;
  RETURN (SELECT jsonb_object_agg(stratum, n) FROM (SELECT stratum, count(*) n FROM person_evidence_sample WHERE policy_version = _policy GROUP BY 1) x);
END $$;

-- ---------- 4. Admin status (read-only) ----------
CREATE OR REPLACE FUNCTION public.get_person_review_status_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '30s' AS $$
DECLARE g public.external_ai_budget_grants;
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role' OR public.has_role(auth.uid(), 'admin')) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO g FROM external_ai_budget_grants ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'generated_at', now(),
    'pairs', (SELECT jsonb_object_agg(disposition, n) FROM (SELECT disposition, count(*) n FROM person_pair_dispositions GROUP BY 1) x),
    'pair_reasons', (SELECT jsonb_agg(jsonb_build_object('disposition', disposition, 'reason', reason_code, 'n', n) ORDER BY n DESC)
        FROM (SELECT disposition, reason_code, count(*) n FROM person_pair_dispositions GROUP BY 1, 2) x),
    'superseded_duplicate_rows', (SELECT COALESCE(sum((detail->>'dup_rows')::int), 0) FROM person_pair_dispositions WHERE disposition = 'decided_accepted'),
    'classifier', (SELECT value FROM app_settings WHERE key = 'person_pair_disposition_cursor'),
    'budget', CASE WHEN g.id IS NULL THEN NULL ELSE jsonb_build_object(
      'grant_id', g.id, 'status', g.status, 'expires_at', g.expires_at, 'total_cap_usd', g.total_cap_usd, 'pilot_cap_usd', g.pilot_cap_usd,
      'legacy_cap_usd', g.legacy_cap_usd, 'account_ceiling_usd', g.account_ceiling_usd, 'daily_cap_usd', g.daily_cap_usd, 'baseline', g.baseline,
      'lanes', (SELECT jsonb_agg(jsonb_build_object('lane', lane, 'carryover', carryover, 'status', status, 'reserved_usd', r, 'actual_usd', a, 'n', n))
          FROM (SELECT lane, carryover, status, sum(reserved_usd) r, sum(COALESCE(actual_usd, 0)) a, count(*) n
                  FROM external_ai_budget_ledger WHERE grant_id = g.id GROUP BY 1, 2, 3) x),
      'committed_all_usd', (SELECT COALESCE(sum(GREATEST(reserved_usd, COALESCE(actual_usd,0))), 0) FROM external_ai_budget_ledger WHERE grant_id = g.id AND status <> 'released'),
      'committed_new_usd', (SELECT COALESCE(sum(GREATEST(reserved_usd, COALESCE(actual_usd,0))), 0) FROM external_ai_budget_ledger WHERE grant_id = g.id AND status <> 'released' AND lane <> 'legacy'),
      'committed_pilot_usd', (SELECT COALESCE(sum(GREATEST(reserved_usd, COALESCE(actual_usd,0))), 0) FROM external_ai_budget_ledger WHERE grant_id = g.id AND status <> 'released' AND lane = 'evidence_pilot'),
      'committed_legacy_usd', (SELECT COALESCE(sum(GREATEST(reserved_usd, COALESCE(actual_usd,0))), 0) FROM external_ai_budget_ledger WHERE grant_id = g.id AND status <> 'released' AND lane = 'legacy' AND NOT carryover),
      'today_usd', (SELECT COALESCE(sum(GREATEST(reserved_usd, COALESCE(actual_usd,0))), 0) FROM external_ai_budget_ledger WHERE grant_id = g.id AND status <> 'released' AND NOT carryover AND created_at >= date_trunc('day', now()))
    ) END,
    'gate', (SELECT to_jsonb(r) FROM person_evidence_gate_runs r ORDER BY id DESC LIMIT 1),
    'evidence_controls', (SELECT value FROM app_settings WHERE key = 'person_evidence_review_controls'),
    'evidence_jobs', (SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY j.created_at DESC), '[]'::jsonb) FROM (
        SELECT id, lane, model, status, request_count, reserved_cost_usd, actual_cost_usd, openai_batch_id, request_counts, last_error, created_at, submitted_at, ingested_at
          FROM person_evidence_jobs ORDER BY created_at DESC LIMIT 10) j),
    'evidence_items', (SELECT COALESCE(jsonb_agg(jsonb_build_object('model', model, 'status', status, 'verdict', verdict, 'n', n)), '[]'::jsonb)
        FROM (SELECT model, status, verdict, count(*) n FROM person_evidence_items GROUP BY 1, 2, 3) x),
    'evidence_sample', (SELECT jsonb_object_agg(stratum, n) FROM (SELECT stratum, count(*) n FROM person_evidence_sample GROUP BY 1) x),
    'evidence_packs', (SELECT jsonb_object_agg(COALESCE(precheck, 'sendable'), n) FROM (SELECT precheck, count(*) n FROM person_evidence_packs GROUP BY 1) x),
    'references', (SELECT count(*) FROM person_evidence_references),
    'goldens', (SELECT count(*) FROM person_relevance_goldens),
    'legacy_controls', (SELECT jsonb_build_object('enabled', value->'enabled', 'escalation_enabled', value->'escalation_enabled', 'paused_reason', value->'paused_reason',
        'escalation_paused', value->'escalation_paused') FROM app_settings WHERE key = 'person_relevance_openai_batch_controls'),
    'legacy_open_jobs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('tier', tier, 'status', status, 'requests', request_count, 'reserved_usd', reserved_cost_usd, 'batch', openai_batch_id)), '[]'::jsonb)
        FROM person_relevance_batch_jobs WHERE status NOT IN ('ingested','aborted','draft'))
  );
END $$;

-- ---------- 5. Execute rights: backend only, except the admin-checked read-only status ----------
REVOKE ALL ON FUNCTION public.external_ai_budget_charge_v1(text, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.external_ai_budget_job_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.person_pair_disposition_log_trg() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.classify_person_pair_dispositions_v1(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.person_pair_dispositions_tick_v1(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.person_evidence_source_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.person_evidence_pilot_select_v1(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_person_review_status_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.external_ai_budget_charge_v1(text, text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.classify_person_pair_dispositions_v1(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.person_pair_dispositions_tick_v1(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.person_evidence_source_v1(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.person_evidence_pilot_select_v1(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_person_review_status_v1() TO authenticated, service_role;

INSERT INTO app_settings (key, value, updated_at) VALUES ('person_evidence_review_controls', jsonb_build_object(
  'enabled', false, 'policy_version', 'person-evidence-v1', 'seed', 'pilot-2026-11-14',
  'pilot_models', jsonb_build_array(jsonb_build_object('model', 'gpt-6-luna', 'subset_rank_max', null), jsonb_build_object('model', 'gpt-6-sol', 'subset_rank_max', 40)),
  'max_output_tokens', 900, 'prepare_per_tick', 40, 'shadow_only', true, 'bulk_enabled', false,
  'note', 'Shadow pilot: results never change public person links. Bulk lane requires a passed gate run.'), now())
ON CONFLICT (key) DO NOTHING;