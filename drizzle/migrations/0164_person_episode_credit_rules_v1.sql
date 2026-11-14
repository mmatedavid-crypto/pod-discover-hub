CREATE TABLE IF NOT EXISTS public.person_episode_credit_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE,
  podcast_id uuid NOT NULL,
  title_pattern text,
  credit_pattern text NOT NULL,
  credit_role text NOT NULL CHECK (credit_role IN ('narrator','preacher','performer','guest','speaker','host')),
  match_action text NOT NULL DEFAULT 'accept_participant' CHECK (match_action IN ('accept_participant','none')),
  correct_feed_credits boolean NOT NULL DEFAULT false,
  feed_credit_person_ids uuid[] NOT NULL DEFAULT '{}',
  anchor_person_ids uuid[] NOT NULL DEFAULT '{}',
  source_url text NOT NULL,
  source_quote text NOT NULL,
  source_hash text NOT NULL,
  provenance text NOT NULL,
  owner_confirmed boolean NOT NULL DEFAULT false,
  verified_at timestamptz NOT NULL DEFAULT now(),
  version text NOT NULL DEFAULT 'episode-credit-2026-11-14-v1',
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.person_episode_credit_resolutions (
  id bigserial PRIMARY KEY,
  rule_id uuid NOT NULL REFERENCES public.person_episode_credit_rules(id),
  rule_version text NOT NULL,
  person_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('credited_role','feed_credit_not_episode')),
  credit_quote text,
  before_mentions jsonb NOT NULL DEFAULT '[]',
  before_disposition jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  undo_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS person_episode_credit_resolutions_live_uq
  ON public.person_episode_credit_resolutions (person_id, episode_id) WHERE undone_at IS NULL;
CREATE INDEX IF NOT EXISTS person_episode_credit_resolutions_rule_idx ON public.person_episode_credit_resolutions (rule_id, episode_id);

GRANT SELECT ON public.person_episode_credit_rules, public.person_episode_credit_resolutions TO authenticated;
GRANT ALL ON public.person_episode_credit_rules, public.person_episode_credit_resolutions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.person_episode_credit_resolutions_id_seq TO service_role;
ALTER TABLE public.person_episode_credit_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_episode_credit_resolutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read episode credit rules" ON public.person_episode_credit_rules;
CREATE POLICY "Admins read episode credit rules" ON public.person_episode_credit_rules FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins read episode credit resolutions" ON public.person_episode_credit_resolutions;
CREATE POLICY "Admins read episode credit resolutions" ON public.person_episode_credit_resolutions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Multi-token name (or scoped alias) inside folded text; last token may carry the Hungarian accusative ending.
CREATE OR REPLACE FUNCTION public.person_credit_name_in_text_v1(_name text, _folded text)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN f IS NULL OR position(' ' IN f) = 0 OR length(f) < 5 OR _folded IS NULL THEN false
    ELSE _folded ~ ('(^|[^a-z0-9])' || regexp_replace(regexp_replace(f, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g'), '\s+', '\\s+', 'g')
                    || '(t|ot|et|at)?($|[^a-z0-9])') END
  FROM (SELECT public.person_text_fold_v1(_name) f) s
$$;

-- Raw credit text from the episode description (HTML stripped), only when the sub-show title matches.
CREATE OR REPLACE FUNCTION public.person_episode_credit_capture_v1(_pattern text, _title_pattern text, _title text, _description text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN _title_pattern IS NOT NULL AND COALESCE(_title, '') !~* _title_pattern THEN NULL
    ELSE btrim((regexp_match(regexp_replace(replace(replace(COALESCE(_description, ''), '&nbsp;', ' '), '&amp;', '&'), '<[^>]+>', ' ', 'g'), _pattern, 'i'))[1]) END
$$;

CREATE OR REPLACE FUNCTION public.person_episode_credit_decide_v1(_person uuid, _episode uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH base AS (
    SELECT r.*, c.q, e.title, e.description, e.podcast_id AS ep_podcast,
      ARRAY(SELECT pe.name FROM people pe WHERE pe.id = _person
            UNION SELECT a.alias FROM person_aliases a WHERE a.person_id = _person AND a.status = 'accepted'
              AND (a.scope = 'global' OR (a.scope = 'podcast' AND a.scope_podcast_id = e.podcast_id))) names
    FROM person_episode_credit_rules r JOIN episodes e ON e.id = _episode AND e.podcast_id = r.podcast_id
    CROSS JOIN LATERAL (SELECT public.person_episode_credit_capture_v1(r.credit_pattern, r.title_pattern, e.title, e.description) q) c
    WHERE r.active AND c.q IS NOT NULL AND length(c.q) >= 3),
  d AS (
    SELECT b.*,
      EXISTS (SELECT 1 FROM unnest(b.names) n WHERE public.person_credit_name_in_text_v1(n, public.person_text_fold_v1(b.q))) hit,
      EXISTS (SELECT 1 FROM unnest(b.names) n WHERE public.person_credit_name_in_text_v1(n, public.person_text_fold_v1(concat_ws(' ', b.title, b.description)))) named_anywhere,
      (_person = ANY (b.anchor_person_ids) OR EXISTS (
         SELECT 1 FROM people p WHERE p.id = _person AND NOT COALESCE(p.identity_ambiguous, false)
           AND COALESCE(p.identity_status, 'normal') IN ('normal', 'confirmed', 'context_resolved')
           AND NOT EXISTS (SELECT 1 FROM people o WHERE o.normalized_name = p.normalized_name AND o.id <> p.id AND o.is_public)
           AND NOT EXISTS (SELECT 1 FROM person_episode_mentions x WHERE x.person_id = _person AND x.relevance_status = 'accepted'
                             AND x.podcast_id IS DISTINCT FROM b.ep_podcast))) anchored
    FROM base b),
  o AS (
    SELECT d.*, CASE
      WHEN d.hit AND d.match_action = 'accept_participant' THEN CASE WHEN d.anchored THEN 'credited_role' ELSE 'credit_identity_unanchored' END
      WHEN d.hit THEN NULL
      WHEN d.correct_feed_credits AND _person = ANY (d.feed_credit_person_ids) AND NOT d.named_anywhere THEN 'feed_credit_not_episode'
      END outcome FROM d)
  SELECT jsonb_build_object('rule_id', o.id, 'outcome', o.outcome, 'quote', o.q, 'role', o.credit_role, 'version', o.version,
           'source_url', o.source_url, 'source_hash', o.source_hash, 'provenance', o.provenance)
  FROM o WHERE o.outcome IS NOT NULL ORDER BY (o.outcome = 'credited_role') DESC, o.rule_key LIMIT 1
$$;

-- Pair may be changed by the credit lane: no explicit decision, no namesake flag, no live provider lease.
CREATE OR REPLACE FUNCTION public.person_episode_credit_pair_ok_v1(_person uuid, _episode uuid, _outcome text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM person_episode_mentions m WHERE m.person_id = _person AND m.episode_id = _episode
      AND (m.relevance_status IN ('accepted','rejected') OR COALESCE(m.validation_source,'') ~* 'manual|chatgpt|external_review'
        OR m.ai_identity_match IN ('different_person_same_name','substring_false_positive')
        OR m.relevance_status NOT IN ('pending','needs_review','waiting_clean_text','in_progress','resolved_show_host')
        OR (_outcome = 'feed_credit_not_episode' AND (m.relevance_status = 'resolved_show_host' OR COALESCE(m.source,'') <> 'rss_author'))))
    AND NOT EXISTS (SELECT 1 FROM person_pair_dispositions d WHERE d.person_id = _person AND d.episode_id = _episode
      AND (d.disposition IN ('decided_accepted','decided_rejected','human_contradiction_review') OR COALESCE(d.decided_by,'') LIKE 'human:%'))
    AND NOT EXISTS (SELECT 1 FROM person_relevance_work w JOIN person_relevance_batch_jobs j ON j.id = w.claim_token
      WHERE w.person_id = _person AND w.episode_id = _episode AND w.lease_until > now()
        AND j.status IN ('claimed','uploading','submitted','validating','in_progress','finalizing','cancelling','ingesting','completed'))
$$;

CREATE OR REPLACE FUNCTION public.apply_person_episode_credit_rules_v1(_limit integer DEFAULT 2000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '170s' AS $$
DECLARE n integer; nm integer; unanchored integer;
BEGIN
  DROP TABLE IF EXISTS pg_temp._credit_cand;
  CREATE TEMP TABLE _credit_cand ON COMMIT DROP AS
  SELECT k.person_id, k.episode_id, public.person_episode_credit_decide_v1(k.person_id, k.episode_id) dec
  FROM (SELECT DISTINCT m.person_id, m.episode_id FROM person_episode_mentions m
        JOIN episodes e ON e.id = m.episode_id
        WHERE e.podcast_id IN (SELECT podcast_id FROM person_episode_credit_rules WHERE active)
          AND m.relevance_status IN ('pending','needs_review','waiting_clean_text','in_progress','resolved_show_host')
          AND NOT EXISTS (SELECT 1 FROM person_episode_credit_resolutions x WHERE x.person_id = m.person_id AND x.episode_id = m.episode_id
                            AND (x.undone_at IS NULL OR x.rule_version = (SELECT r.version FROM person_episode_credit_rules r WHERE r.id = x.rule_id)))) k;
  SELECT count(*) INTO unanchored FROM _credit_cand WHERE dec->>'outcome' = 'credit_identity_unanchored';
  DROP TABLE IF EXISTS pg_temp._credit_apply;
  CREATE TEMP TABLE _credit_apply ON COMMIT DROP AS
  SELECT c.person_id, c.episode_id, c.dec, (c.dec->>'rule_id')::uuid rule_id, c.dec->>'outcome' outcome
  FROM _credit_cand c
  WHERE c.dec->>'outcome' IN ('credited_role','feed_credit_not_episode')
    AND public.person_episode_credit_pair_ok_v1(c.person_id, c.episode_id, c.dec->>'outcome')
  ORDER BY c.episode_id, c.person_id
  LIMIT LEAST(GREATEST(_limit, 1), 10000);

  INSERT INTO person_episode_credit_resolutions (rule_id, rule_version, person_id, episode_id, outcome, credit_quote, before_mentions, before_disposition)
  SELECT a.rule_id, a.dec->>'version', a.person_id, a.episode_id, a.outcome, a.dec->>'quote',
    COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM person_episode_mentions m WHERE m.person_id = a.person_id AND m.episode_id = a.episode_id), '[]'::jsonb),
    (SELECT to_jsonb(d) FROM person_pair_dispositions d WHERE d.person_id = a.person_id AND d.episode_id = a.episode_id)
  FROM _credit_apply a;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Owner/publisher-sourced credit is allowed to lift a show-roster pair to an explicit appearance.
  PERFORM set_config('podiverzum.host_rule_undo', 'on', true);
  PERFORM set_config('podiverzum.episode_credit_write', 'on', true);
  UPDATE person_episode_mentions m SET
    relevance_status = CASE WHEN a.outcome = 'credited_role' THEN 'accepted' ELSE 'resolved_feed_credit_not_episode' END,
    role_type = CASE WHEN a.outcome = 'credited_role' THEN 'participant' ELSE m.role_type END,
    validation_source = CASE WHEN a.outcome = 'credited_role' THEN 'deterministic_episode_credit_v1' ELSE 'deterministic_feed_credit_correction_v1' END,
    source_evidence = COALESCE(m.source_evidence, '{}') || jsonb_build_object('episode_credit_rule_id', a.rule_id, 'credit_role', a.dec->>'role',
      'credit_quote', a.dec->>'quote', 'source_url', a.dec->>'source_url', 'source_hash', a.dec->>'source_hash',
      'provenance', CASE WHEN a.outcome = 'credited_role' THEN 'explicit_episode_credit' ELSE 'feed_credit_correction' END, 'rule_version', a.dec->>'version'),
    role_reason = CASE WHEN a.outcome = 'credited_role'
      THEN 'Az epizód kiadói leírása név szerint megnevezi (' || (a.dec->>'role') || '): „' || left(a.dec->>'quote', 200) || '”.'
      ELSE 'A jelölt csak a műsor RSS-szerzőmezőjéből keletkezett; az epizód leírása kifejezetten mást nevez meg („' || left(a.dec->>'quote', 160)
        || '”). Ez a hibás automatikus jelölés javítása, nem bizonyított nemszereplés.' END
  FROM _credit_apply a WHERE m.person_id = a.person_id AND m.episode_id = a.episode_id
    AND m.relevance_status IN ('pending','needs_review','waiting_clean_text','in_progress','resolved_show_host');
  GET DIAGNOSTICS nm = ROW_COUNT;

  INSERT INTO person_pair_dispositions AS d (person_id, episode_id, disposition, reason_code, policy_version, decided_by, detail, reopen_on_source_change)
  SELECT a.person_id, a.episode_id,
    CASE WHEN a.outcome = 'credited_role' THEN 'decided_accepted' ELSE 'resolved_feed_credit_not_episode' END,
    CASE WHEN a.outcome = 'credited_role' THEN 'explicit_episode_credit' ELSE 'explicit_other_credit' END,
    a.dec->>'version', 'deterministic:episode-credit-v1',
    jsonb_build_object('episode_credit_rule_id', a.rule_id, 'credit_role', a.dec->>'role', 'credit_quote', a.dec->>'quote'), false
  FROM _credit_apply a
  ON CONFLICT (person_id, episode_id) DO UPDATE SET disposition = EXCLUDED.disposition, reason_code = EXCLUDED.reason_code,
    policy_version = EXCLUDED.policy_version, decided_by = EXCLUDED.decided_by,
    detail = COALESCE(d.detail, '{}') || EXCLUDED.detail, reopen_on_source_change = false, updated_at = now();
  PERFORM set_config('podiverzum.host_rule_undo', 'off', true);
  PERFORM set_config('podiverzum.episode_credit_write', 'off', true);

  RETURN jsonb_build_object('resolved_pairs', n, 'updated_mentions', nm,
    'credited_role', (SELECT count(*) FROM _credit_apply WHERE outcome = 'credited_role'),
    'feed_credit_not_episode', (SELECT count(*) FROM _credit_apply WHERE outcome = 'feed_credit_not_episode'),
    'skipped_identity_unanchored', unanchored);
END $$;

-- Protect lane decisions from AI ingest / re-import; decide new links on insert.
CREATE OR REPLACE FUNCTION public.protect_episode_credit_mention_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE dec jsonb; oc text;
BEGIN
  IF current_setting('podiverzum.episode_credit_write', true) = 'on' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.validation_source,'') ~* 'manual|chatgpt|external_review' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.validation_source IN ('deterministic_episode_credit_v1','deterministic_feed_credit_correction_v1') THEN
      NEW.relevance_status := OLD.relevance_status; NEW.role_type := OLD.role_type; NEW.validation_source := OLD.validation_source;
      NEW.source_evidence := OLD.source_evidence; NEW.role_reason := OLD.role_reason;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.relevance_status NOT IN ('pending','needs_review','waiting_clean_text') THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM person_episode_credit_rules r JOIN episodes e ON e.podcast_id = r.podcast_id
                 WHERE e.id = NEW.episode_id AND r.active) THEN RETURN NEW; END IF;
  dec := public.person_episode_credit_decide_v1(NEW.person_id, NEW.episode_id);
  oc := dec->>'outcome';
  IF oc IS NULL OR oc NOT IN ('credited_role','feed_credit_not_episode') THEN RETURN NEW; END IF;
  IF oc = 'feed_credit_not_episode' AND COALESCE(NEW.source,'') <> 'rss_author' THEN RETURN NEW; END IF;
  IF NOT public.person_episode_credit_pair_ok_v1(NEW.person_id, NEW.episode_id, oc) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM person_episode_credit_resolutions x WHERE x.person_id = NEW.person_id AND x.episode_id = NEW.episode_id AND x.undone_at IS NULL) THEN RETURN NEW; END IF;
  INSERT INTO person_episode_credit_resolutions (rule_id, rule_version, person_id, episode_id, outcome, credit_quote, before_mentions, before_disposition)
  VALUES ((dec->>'rule_id')::uuid, dec->>'version', NEW.person_id, NEW.episode_id, oc, dec->>'quote',
    COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM person_episode_mentions m WHERE m.person_id = NEW.person_id AND m.episode_id = NEW.episode_id), '[]'::jsonb) || jsonb_build_array(to_jsonb(NEW)),
    (SELECT to_jsonb(d) FROM person_pair_dispositions d WHERE d.person_id = NEW.person_id AND d.episode_id = NEW.episode_id));
  IF oc = 'credited_role' THEN
    NEW.relevance_status := 'accepted'; NEW.role_type := 'participant'; NEW.validation_source := 'deterministic_episode_credit_v1';
    NEW.role_reason := 'Az epizód kiadói leírása név szerint megnevezi (' || (dec->>'role') || '): „' || left(dec->>'quote', 200) || '”.';
  ELSE
    NEW.relevance_status := 'resolved_feed_credit_not_episode'; NEW.validation_source := 'deterministic_feed_credit_correction_v1';
    NEW.role_reason := 'A jelölt csak a műsor RSS-szerzőmezőjéből keletkezett; az epizód leírása kifejezetten mást nevez meg („' || left(dec->>'quote', 160)
      || '”). Ez a hibás automatikus jelölés javítása, nem bizonyított nemszereplés.';
  END IF;
  NEW.source_evidence := COALESCE(NEW.source_evidence, '{}') || jsonb_build_object('episode_credit_rule_id', dec->>'rule_id', 'credit_role', dec->>'role',
    'credit_quote', dec->>'quote', 'source_url', dec->>'source_url', 'source_hash', dec->>'source_hash', 'rule_version', dec->>'version',
    'provenance', CASE WHEN oc = 'credited_role' THEN 'explicit_episode_credit' ELSE 'feed_credit_correction' END);
  INSERT INTO person_pair_dispositions AS d (person_id, episode_id, disposition, reason_code, policy_version, decided_by, detail, reopen_on_source_change)
  VALUES (NEW.person_id, NEW.episode_id,
    CASE WHEN oc = 'credited_role' THEN 'decided_accepted' ELSE 'resolved_feed_credit_not_episode' END,
    CASE WHEN oc = 'credited_role' THEN 'explicit_episode_credit' ELSE 'explicit_other_credit' END,
    dec->>'version', 'deterministic:episode-credit-v1',
    jsonb_build_object('episode_credit_rule_id', dec->>'rule_id', 'credit_role', dec->>'role', 'credit_quote', dec->>'quote'), false)
  ON CONFLICT (person_id, episode_id) DO UPDATE SET disposition = EXCLUDED.disposition, reason_code = EXCLUDED.reason_code,
    policy_version = EXCLUDED.policy_version, decided_by = EXCLUDED.decided_by, detail = COALESCE(d.detail, '{}') || EXCLUDED.detail,
    reopen_on_source_change = false, updated_at = now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_episode_credit_mention ON public.person_episode_mentions;
CREATE TRIGGER protect_episode_credit_mention BEFORE INSERT OR UPDATE ON public.person_episode_mentions
  FOR EACH ROW EXECUTE FUNCTION public.protect_episode_credit_mention_v1();

-- Show-roster protection must not force a pair back to resolved_show_host once an explicit episode credit accepted it.
CREATE OR REPLACE FUNCTION public.protect_host_rule_disposition_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  IF current_setting('podiverzum.host_rule_undo', true) = 'on' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.decided_by,'') LIKE 'human:%' OR NEW.decided_by = 'deterministic:episode-credit-v1' THEN RETURN NEW; END IF;
  SELECT h.* INTO r FROM person_host_rule_resolutions x JOIN person_host_rules h ON h.id = x.rule_id
  WHERE x.person_id = NEW.person_id AND x.episode_id = NEW.episode_id AND h.active;
  IF FOUND AND NOT EXISTS (SELECT 1 FROM person_episode_mentions m WHERE m.person_id = NEW.person_id AND m.episode_id = NEW.episode_id
      AND (COALESCE(m.validation_source,'') ~* 'manual|chatgpt|external_review' OR m.validation_source = 'deterministic_episode_credit_v1')) THEN
    NEW.disposition := 'resolved_show_host'; NEW.reason_code := 'verified_show_host_rule'; NEW.policy_version := r.version;
    NEW.decided_by := 'deterministic:show_host_rule';
    NEW.detail := COALESCE(NEW.detail, '{}') || jsonb_build_object('host_rule_id', r.id, 'provenance', 'inherited_show_host', 'canonical_person_id', r.canonical_person_id);
    NEW.reopen_on_source_change := false;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.undo_person_episode_credit_pairs_v1(_rule_id uuid, _episode_ids uuid[], _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE x record; m jsonb; n integer := 0;
BEGIN
  IF COALESCE(btrim(_reason), '') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  PERFORM set_config('podiverzum.host_rule_undo', 'on', true);
  PERFORM set_config('podiverzum.episode_credit_write', 'on', true);
  FOR x IN SELECT * FROM person_episode_credit_resolutions r WHERE r.rule_id = _rule_id AND r.undone_at IS NULL
             AND (_episode_ids IS NULL OR r.episode_id = ANY (_episode_ids)) FOR UPDATE LOOP
    FOR m IN SELECT * FROM jsonb_array_elements(x.before_mentions) LOOP
      UPDATE person_episode_mentions SET relevance_status = m->>'relevance_status', role_type = m->>'role_type',
        validation_source = m->>'validation_source', source_evidence = m->'source_evidence', role_reason = m->>'role_reason'
      WHERE id = (m->>'id')::uuid AND validation_source IN ('deterministic_episode_credit_v1','deterministic_feed_credit_correction_v1');
    END LOOP;
    IF x.before_disposition IS NOT NULL THEN
      UPDATE person_pair_dispositions SET disposition = x.before_disposition->>'disposition', reason_code = x.before_disposition->>'reason_code',
        policy_version = x.before_disposition->>'policy_version', decided_by = x.before_disposition->>'decided_by',
        detail = x.before_disposition->'detail', reopen_on_source_change = (x.before_disposition->>'reopen_on_source_change')::boolean, updated_at = now()
      WHERE person_id = x.person_id AND episode_id = x.episode_id AND decided_by = 'deterministic:episode-credit-v1';
    ELSE
      DELETE FROM person_pair_dispositions WHERE person_id = x.person_id AND episode_id = x.episode_id AND decided_by = 'deterministic:episode-credit-v1';
    END IF;
    UPDATE person_episode_credit_resolutions SET undone_at = now(), undo_reason = _reason WHERE id = x.id;
    n := n + 1;
  END LOOP;
  PERFORM set_config('podiverzum.host_rule_undo', 'off', true);
  PERFORM set_config('podiverzum.episode_credit_write', 'off', true);
  RETURN jsonb_build_object('undone', n);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.person_credit_name_in_text_v1(text,text)', 'public.person_episode_credit_capture_v1(text,text,text,text)',
    'public.person_episode_credit_decide_v1(uuid,uuid)', 'public.person_episode_credit_pair_ok_v1(uuid,uuid,text)',
    'public.apply_person_episode_credit_rules_v1(integer)', 'public.protect_episode_credit_mention_v1()',
    'public.protect_host_rule_disposition_v1()', 'public.undo_person_episode_credit_pairs_v1(uuid,uuid[],text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM readonly_codex', f); END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;