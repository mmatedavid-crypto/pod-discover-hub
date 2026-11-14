-- Show-host rules v2: versioned schema for the owner-approved show-host lane (tables first created 2026-11-14 outside a migration).
CREATE TABLE IF NOT EXISTS public.person_host_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE,
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id),
  person_id uuid NOT NULL REFERENCES public.people(id),
  canonical_person_id uuid NOT NULL REFERENCES public.people(id),
  role_type text NOT NULL DEFAULT 'host',
  title_pattern text,
  valid_from date,
  valid_until date,
  source_url text NOT NULL,
  source_quote text NOT NULL,
  provenance text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version text NOT NULL DEFAULT 'host-rule-2026-11-14-v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
);
CREATE INDEX IF NOT EXISTS person_host_rules_lookup ON public.person_host_rules (podcast_id, person_id) WHERE active;
CREATE TABLE IF NOT EXISTS public.person_host_rule_resolutions (
  person_id uuid NOT NULL REFERENCES public.people(id),
  episode_id uuid NOT NULL REFERENCES public.episodes(id),
  rule_id uuid NOT NULL REFERENCES public.person_host_rules(id),
  canonical_person_id uuid NOT NULL REFERENCES public.people(id),
  before_mentions jsonb NOT NULL,
  before_disposition jsonb,
  provenance text NOT NULL DEFAULT 'inherited_show_host',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, episode_id)
);
CREATE INDEX IF NOT EXISTS person_host_rule_resolutions_rule_idx ON public.person_host_rule_resolutions (rule_id);

ALTER TABLE public.person_host_rules ADD COLUMN IF NOT EXISTS source_hash text;
ALTER TABLE public.person_host_rules ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.person_host_rules ADD COLUMN IF NOT EXISTS owner_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE public.person_host_rules ADD COLUMN IF NOT EXISTS valid_scope text NOT NULL DEFAULT 'stored_series';
ALTER TABLE public.person_host_rules ADD COLUMN IF NOT EXISTS notes text;
UPDATE public.person_host_rules SET
  source_hash = COALESCE(source_hash, md5(source_url || '|' || source_quote)),
  verified_at = COALESCE(verified_at, created_at),
  owner_confirmed = provenance IN ('owner_confirmed', 'owner_and_publisher'),
  valid_scope = CASE WHEN valid_from IS NOT NULL OR valid_until IS NOT NULL THEN 'dated' ELSE 'stored_series' END;
COMMENT ON COLUMN public.person_host_rules.valid_scope IS 'stored_series: show-level role for the stored series, no invented join date; dated: valid_from/valid_until from an owner or publisher source';
COMMENT ON COLUMN public.person_host_rules.owner_confirmed IS 'true only where the owner personally stated the host fact';

REVOKE ALL ON public.person_host_rules FROM anon, authenticated;
REVOKE ALL ON public.person_host_rule_resolutions FROM anon, authenticated;
GRANT SELECT ON public.person_host_rules TO authenticated;
GRANT SELECT ON public.person_host_rule_resolutions TO authenticated;
GRANT ALL ON public.person_host_rules TO service_role;
GRANT ALL ON public.person_host_rule_resolutions TO service_role;
ALTER TABLE public.person_host_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_host_rule_resolutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read host rules" ON public.person_host_rules;
CREATE POLICY "Admins read host rules" ON public.person_host_rules FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins read host rule resolutions" ON public.person_host_rule_resolutions;
CREATE POLICY "Admins read host rule resolutions" ON public.person_host_rule_resolutions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Explicit episode-level contradiction: the episode text says a host was away or replaced.
CREATE OR REPLACE FUNCTION public.person_host_rule_episode_contradiction_v1(_episode uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT substring(s.t from '(tavolleteben|helyettesit[a-z]*|kenyszerpihen[a-z]*|szabadsagon|nelkule\M|nelkulem\M|nelkuluk\M|nelkulunk\M|betegseg miatt|beteg lett|helyett vezet[a-z]*|vendegmusorvezet[a-z]*|beugro[a-z]*)')
  FROM (SELECT public.person_text_fold_v1(concat_ws(' ', e.title, e.description)) t FROM episodes e WHERE e.id = _episode) s
$$;

CREATE OR REPLACE FUNCTION public.match_person_host_rule_v1(_person uuid, _episode uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT r.id FROM person_host_rules r JOIN episodes e ON e.podcast_id = r.podcast_id
  WHERE e.id = _episode AND r.person_id = _person AND r.active
    AND (r.valid_from IS NULL OR e.published_at::date >= r.valid_from)
    AND (r.valid_until IS NULL OR e.published_at::date < r.valid_until)
    AND (r.title_pattern IS NULL OR e.title ~* r.title_pattern)
    AND public.person_host_rule_episode_contradiction_v1(e.id) IS NULL
  ORDER BY (r.title_pattern IS NOT NULL) DESC, r.rule_key LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.apply_person_host_rules_v1(_limit integer DEFAULT 2000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s' AS $$
DECLARE n integer; nm integer;
BEGIN
  DROP TABLE IF EXISTS pg_temp._host_apply;
  CREATE TEMP TABLE _host_apply ON COMMIT DROP AS
  SELECT d.person_id, d.episode_id, r.id rule_id, r.canonical_person_id, r.source_quote, r.source_url, r.source_hash, r.version, to_jsonb(d) before_disposition
  FROM person_pair_dispositions d JOIN episodes e ON e.id = d.episode_id
  JOIN person_host_rules r ON r.person_id = d.person_id AND r.podcast_id = e.podcast_id AND r.active
    AND (r.valid_from IS NULL OR e.published_at::date >= r.valid_from) AND (r.valid_until IS NULL OR e.published_at::date < r.valid_until)
    AND (r.title_pattern IS NULL OR e.title ~* r.title_pattern)
  WHERE d.disposition NOT IN ('decided_accepted','decided_rejected','resolved_show_host','human_contradiction_review')
    AND COALESCE(d.decided_by,'') NOT LIKE 'human:%'
    AND public.person_host_rule_episode_contradiction_v1(e.id) IS NULL
    AND NOT EXISTS (SELECT 1 FROM person_host_rule_resolutions x WHERE x.person_id = d.person_id AND x.episode_id = d.episode_id)
    AND NOT EXISTS (SELECT 1 FROM person_episode_mentions m WHERE m.person_id = d.person_id AND m.episode_id = d.episode_id
      AND (m.relevance_status IN ('accepted','rejected') OR COALESCE(m.validation_source,'') ~* 'manual|chatgpt|external_review'
        OR m.ai_identity_match IN ('different_person_same_name','substring_false_positive')))
    AND NOT EXISTS (SELECT 1 FROM person_relevance_work w JOIN person_relevance_batch_jobs j ON j.id = w.claim_token
      WHERE w.person_id = d.person_id AND w.episode_id = d.episode_id AND w.lease_until > now()
        AND j.status IN ('claimed','uploading','submitted','validating','in_progress','finalizing','cancelling','ingesting','completed'))
  ORDER BY (SELECT count(*) FROM episodes ep WHERE ep.podcast_id = e.podcast_id) DESC, e.published_at DESC, d.person_id, d.episode_id
  LIMIT LEAST(GREATEST(_limit, 1), 5000);
  INSERT INTO person_host_rule_resolutions (person_id, episode_id, rule_id, canonical_person_id, before_mentions, before_disposition)
  SELECT a.person_id, a.episode_id, a.rule_id, a.canonical_person_id,
    COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM person_episode_mentions m WHERE m.person_id = a.person_id AND m.episode_id = a.episode_id), '[]'::jsonb),
    a.before_disposition
  FROM _host_apply a ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE person_episode_mentions m SET relevance_status = 'resolved_show_host', role_type = 'host',
    validation_source = 'deterministic_show_host_rule_v1',
    source_evidence = COALESCE(m.source_evidence, '{}') || jsonb_build_object('host_rule_id', a.rule_id, 'provenance', 'inherited_show_host',
      'source_url', a.source_url, 'source_quote', a.source_quote, 'source_hash', a.source_hash, 'canonical_person_id', a.canonical_person_id),
    role_reason = 'A műsor igazolt házigazdája; a szerep műsorszabályból örökölt, nem hangból ellenőrzött megszólalás.'
  FROM _host_apply a WHERE m.person_id = a.person_id AND m.episode_id = a.episode_id
    AND m.relevance_status IN ('pending','needs_review','waiting_clean_text','in_progress');
  GET DIAGNOSTICS nm = ROW_COUNT;
  UPDATE person_pair_dispositions d SET disposition = 'resolved_show_host', reason_code = 'verified_show_host_rule',
    policy_version = a.version, decided_by = 'deterministic:show_host_rule',
    source_fingerprint = md5(a.rule_id::text || a.version || a.source_quote),
    detail = COALESCE(d.detail, '{}') || jsonb_build_object('host_rule_id', a.rule_id, 'provenance', 'inherited_show_host', 'canonical_person_id', a.canonical_person_id),
    reopen_on_source_change = false, updated_at = now()
  FROM _host_apply a WHERE d.person_id = a.person_id AND d.episode_id = a.episode_id;
  RETURN jsonb_build_object('resolved_pairs', n, 'updated_mentions', nm);
END $$;

CREATE OR REPLACE FUNCTION public.protect_host_rule_disposition_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  IF current_setting('podiverzum.host_rule_undo', true) = 'on' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.decided_by,'') LIKE 'human:%' THEN RETURN NEW; END IF;
  SELECT h.* INTO r FROM person_host_rule_resolutions x JOIN person_host_rules h ON h.id = x.rule_id
  WHERE x.person_id = NEW.person_id AND x.episode_id = NEW.episode_id AND h.active;
  IF FOUND AND NOT EXISTS (SELECT 1 FROM person_episode_mentions m WHERE m.person_id = NEW.person_id AND m.episode_id = NEW.episode_id
      AND COALESCE(m.validation_source,'') ~* 'manual|chatgpt|external_review') THEN
    NEW.disposition := 'resolved_show_host'; NEW.reason_code := 'verified_show_host_rule'; NEW.policy_version := r.version;
    NEW.decided_by := 'deterministic:show_host_rule';
    NEW.detail := COALESCE(NEW.detail, '{}') || jsonb_build_object('host_rule_id', r.id, 'provenance', 'inherited_show_host', 'canonical_person_id', r.canonical_person_id);
    NEW.reopen_on_source_change := false;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.protect_host_rule_mention_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE rid uuid; r person_host_rules; d person_pair_dispositions;
BEGIN
  IF current_setting('podiverzum.host_rule_undo', true) = 'on' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.validation_source,'') ~* 'manual|chatgpt|external_review' THEN RETURN NEW; END IF;
  rid := public.match_person_host_rule_v1(NEW.person_id, NEW.episode_id);
  IF rid IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.relevance_status = 'resolved_show_host' THEN
    NEW.relevance_status := OLD.relevance_status; NEW.role_type := OLD.role_type; NEW.validation_source := OLD.validation_source;
    NEW.source_evidence := OLD.source_evidence; NEW.role_reason := OLD.role_reason;
    RETURN NEW;
  END IF;
  IF NEW.relevance_status NOT IN ('pending','needs_review','waiting_clean_text') THEN RETURN NEW; END IF;
  SELECT * INTO d FROM person_pair_dispositions WHERE person_id = NEW.person_id AND episode_id = NEW.episode_id;
  IF d.disposition IN ('decided_accepted','decided_rejected','human_contradiction_review') OR COALESCE(d.decided_by,'') LIKE 'human:%' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM person_episode_mentions m WHERE m.person_id = NEW.person_id AND m.episode_id = NEW.episode_id
      AND (m.relevance_status IN ('accepted','rejected') OR COALESCE(m.validation_source,'') ~* 'manual|chatgpt|external_review'
        OR m.ai_identity_match IN ('different_person_same_name','substring_false_positive'))) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM person_relevance_work w JOIN person_relevance_batch_jobs j ON j.id = w.claim_token
      WHERE w.person_id = NEW.person_id AND w.episode_id = NEW.episode_id AND w.lease_until > now()
        AND j.status IN ('claimed','uploading','submitted','validating','in_progress','finalizing','cancelling','ingesting','completed')) THEN RETURN NEW; END IF;
  SELECT * INTO r FROM person_host_rules WHERE id = rid;
  INSERT INTO person_host_rule_resolutions (person_id, episode_id, rule_id, canonical_person_id, before_mentions, before_disposition)
  VALUES (NEW.person_id, NEW.episode_id, r.id, r.canonical_person_id,
    COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM person_episode_mentions m WHERE m.person_id = NEW.person_id AND m.episode_id = NEW.episode_id), '[]'::jsonb)
      || jsonb_build_array(to_jsonb(NEW)), to_jsonb(d))
  ON CONFLICT DO NOTHING;
  NEW.relevance_status := 'resolved_show_host'; NEW.role_type := 'host'; NEW.validation_source := 'deterministic_show_host_rule_v1';
  NEW.source_evidence := COALESCE(NEW.source_evidence, '{}') || jsonb_build_object('host_rule_id', r.id, 'provenance', 'inherited_show_host',
    'source_url', r.source_url, 'source_quote', r.source_quote, 'source_hash', r.source_hash, 'canonical_person_id', r.canonical_person_id);
  NEW.role_reason := 'A műsor igazolt házigazdája; műsorszabályból örökölt szerep.';
  INSERT INTO person_pair_dispositions (person_id, episode_id, disposition, reason_code, policy_version, decided_by, detail, reopen_on_source_change)
  VALUES (NEW.person_id, NEW.episode_id, 'resolved_show_host', 'verified_show_host_rule', r.version, 'deterministic:show_host_rule',
    jsonb_build_object('host_rule_id', r.id, 'provenance', 'inherited_show_host'), false)
  ON CONFLICT (person_id, episode_id) DO UPDATE SET disposition = 'resolved_show_host', reason_code = 'verified_show_host_rule',
    decided_by = 'deterministic:show_host_rule', updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_host_rule_disposition ON public.person_pair_dispositions;
CREATE TRIGGER protect_host_rule_disposition BEFORE INSERT OR UPDATE ON public.person_pair_dispositions
  FOR EACH ROW EXECUTE FUNCTION public.protect_host_rule_disposition_v1();
DROP TRIGGER IF EXISTS protect_host_rule_mention ON public.person_episode_mentions;
CREATE TRIGGER protect_host_rule_mention BEFORE INSERT OR UPDATE ON public.person_episode_mentions
  FOR EACH ROW EXECUTE FUNCTION public.protect_host_rule_mention_v1();

-- Reversible undo of inherited host pairs (one rule, optionally only some episodes). Audited.
CREATE OR REPLACE FUNCTION public.undo_person_host_rule_pairs_v1(_rule_id uuid, _episode_ids uuid[], _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s' AS $$
DECLARE x record; m jsonb; n integer := 0; d jsonb;
BEGIN
  IF _rule_id IS NULL OR COALESCE(_reason, '') = '' THEN RAISE EXCEPTION 'rule id and reason required'; END IF;
  PERFORM set_config('podiverzum.host_rule_undo', 'on', true);
  FOR x IN SELECT * FROM person_host_rule_resolutions r WHERE r.rule_id = _rule_id
      AND (_episode_ids IS NULL OR r.episode_id = ANY(_episode_ids)) LOOP
    FOR m IN SELECT * FROM jsonb_array_elements(x.before_mentions) LOOP
      UPDATE person_episode_mentions SET relevance_status = m->>'relevance_status', role_type = m->>'role_type',
        validation_source = m->>'validation_source', source_evidence = m->'source_evidence', role_reason = m->>'role_reason'
      WHERE id = (m->>'id')::uuid AND relevance_status = 'resolved_show_host';
    END LOOP;
    DELETE FROM person_host_rule_resolutions WHERE person_id = x.person_id AND episode_id = x.episode_id;
    d := x.before_disposition;
    IF d IS NOT NULL AND jsonb_typeof(d) = 'object' THEN
      UPDATE person_pair_dispositions SET disposition = d->>'disposition', reason_code = d->>'reason_code', decided_by = d->>'decided_by',
        policy_version = d->>'policy_version', detail = COALESCE(d->'detail', '{}'::jsonb), source_fingerprint = d->>'source_fingerprint',
        reopen_on_source_change = COALESCE((d->>'reopen_on_source_change')::boolean, false), updated_at = now()
      WHERE person_id = x.person_id AND episode_id = x.episode_id AND decided_by = 'deterministic:show_host_rule';
    ELSE
      DELETE FROM person_pair_dispositions WHERE person_id = x.person_id AND episode_id = x.episode_id AND decided_by = 'deterministic:show_host_rule';
    END IF;
    INSERT INTO person_pair_lane_audit (lane, action, person_id, episode_id, rule_version, before_state, after_state, evidence)
    VALUES ('show_host', 'undo', x.person_id, x.episode_id, 'host-rule-2026-11-14-v1', to_jsonb(x), d, jsonb_build_object('rule_id', _rule_id, 'reason', left(_reason, 300)));
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('undone', n);
END $$;

-- Role-label lane: resolved show-host pairs are closed.
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
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.person_host_rule_episode_contradiction_v1(uuid)',
    'public.match_person_host_rule_v1(uuid, uuid)',
    'public.apply_person_host_rules_v1(integer)',
    'public.protect_host_rule_disposition_v1()',
    'public.protect_host_rule_mention_v1()',
    'public.undo_person_host_rule_pairs_v1(uuid, uuid[], text)',
    'public.person_role_label_block_v1(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM readonly_codex', f);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;