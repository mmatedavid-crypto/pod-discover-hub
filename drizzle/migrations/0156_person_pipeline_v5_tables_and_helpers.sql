-- Person pipeline v5 (part 1): honest in-progress state, alias scope fix for the old first round,
-- show-level author credits kept apart from episode presence, audit, episode-page evidence cache, lane helpers.

-- In-flight batch items whose person has a rejected or scoped alias would get a new source hash (= wasted billing).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.person_relevance_batch_jobs j
             JOIN public.person_relevance_batch_items i ON i.job_id = j.id
             JOIN public.person_aliases a ON a.person_id = i.person_id AND (a.status <> 'accepted' OR COALESCE(a.scope,'global') <> 'global')
             WHERE j.status IN ('claimed','uploading','submitted','validating','in_progress','finalizing','cancelling','ingesting')) THEN
    RAISE EXCEPTION 'open_person_batch_job_affected: wait until in-flight batches are ingested';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.person_judge_source(_person uuid, _episode uuid)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
 SELECT jsonb_build_object(
  'person', jsonb_build_object('name', person.name,
    'aliases', COALESCE((SELECT jsonb_agg(a.alias ORDER BY a.alias) FROM person_aliases a WHERE a.person_id=_person
        AND a.status = 'accepted'
        AND (COALESCE(a.scope,'global') = 'global' OR (a.scope = 'podcast' AND a.scope_podcast_id = e.podcast_id)
             OR (a.scope = 'episode' AND a.scope_episode_id = e.id))), '[]'::jsonb),
    'disambiguation_label',person.disambiguation_label,'disambiguation_context',left(person.disambiguation_context,800)),
  'episode', jsonb_build_object('id',e.id,'title',e.title,'summary',left(COALESCE(e.summary,''),1200),
    'clean_text',left(COALESCE(clean.cleaned_text,''),6000),'clean_hash',md5(COALESCE(clean.cleaned_text,''))),
  'podcast',jsonb_build_object('title',p.title,'description',left(COALESCE(p.description,''),400)),
  'mentions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'mention_type',m.mention_type,
    'confidence',m.confidence,'evidence',left(m.evidence,500),'role_type',m.role_type,
    'relevance_status',m.relevance_status,'validation_source',m.validation_source,'ai_judged_at',m.ai_judged_at) ORDER BY m.id)
    FROM person_episode_mentions m WHERE m.person_id=_person AND m.episode_id=_episode),'[]'::jsonb))
 FROM people person CROSS JOIN episodes e JOIN podcasts p ON p.id=e.podcast_id
 LEFT JOIN LATERAL (SELECT ect.cleaned_text FROM episode_clean_text ect WHERE ect.episode_id=e.id
   AND ect.cleaner_method LIKE 'deterministic_v4%' LIMIT 1) clean ON true
 WHERE person.id=_person AND e.id=_episode;
$function$;

CREATE TABLE public.person_pair_lane_audit (
  id bigserial PRIMARY KEY,
  lane text NOT NULL,
  action text NOT NULL,
  person_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  mention_id uuid,
  rule_version text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  undone_by text
);
CREATE INDEX person_pair_lane_audit_pair_idx ON public.person_pair_lane_audit (person_id, episode_id);
CREATE INDEX person_pair_lane_audit_lane_idx ON public.person_pair_lane_audit (lane, action, created_at DESC);
GRANT SELECT ON public.person_pair_lane_audit TO authenticated;
GRANT ALL ON public.person_pair_lane_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.person_pair_lane_audit_id_seq TO service_role;
ALTER TABLE public.person_pair_lane_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read person lane audit" ON public.person_pair_lane_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.episode_public_page_evidence (
  episode_id uuid PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
  url text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','same_as_rss','show_level','no_meta','http_error','fetch_error','blocked')),
  http_status integer,
  page_title text,
  page_description text,
  content_hash text,
  attempts integer NOT NULL DEFAULT 1,
  error text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX episode_public_page_evidence_fetched_idx ON public.episode_public_page_evidence (fetched_at DESC);
GRANT SELECT ON public.episode_public_page_evidence TO authenticated;
GRANT ALL ON public.episode_public_page_evidence TO service_role;
ALTER TABLE public.episode_public_page_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read episode page evidence" ON public.episode_public_page_evidence FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.person_show_credits (
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  credit_kind text NOT NULL CHECK (credit_kind IN ('rss_author_host')),
  show_confirmed boolean NOT NULL DEFAULT false,
  show_quote text,
  source_field text NOT NULL,
  source_hash text NOT NULL,
  rule_version text NOT NULL,
  episode_pairs integer NOT NULL DEFAULT 0,
  episode_text_pairs integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, podcast_id, credit_kind)
);
CREATE INDEX person_show_credits_podcast_idx ON public.person_show_credits (podcast_id);
GRANT SELECT ON public.person_show_credits TO authenticated;
GRANT ALL ON public.person_show_credits TO service_role;
ALTER TABLE public.person_show_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read person show credits" ON public.person_show_credits FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.person_role_label_results (
  person_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  rule_version text NOT NULL,
  source_hash text NOT NULL,
  outcome text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, episode_id, rule_version)
);
CREATE INDEX person_role_label_results_outcome_idx ON public.person_role_label_results (rule_version, outcome);
GRANT SELECT ON public.person_role_label_results TO authenticated;
GRANT ALL ON public.person_role_label_results TO service_role;
ALTER TABLE public.person_role_label_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read role label results" ON public.person_role_label_results FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.person_source_lane_leases (
  lane text PRIMARY KEY,
  token uuid,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.person_source_lane_leases TO service_role;
ALTER TABLE public.person_source_lane_leases ENABLE ROW LEVEL SECURITY;

-- Shared text fold (mirrors foldForMatch in _shared/person-role-label.ts).
CREATE OR REPLACE FUNCTION public.person_text_fold_v1(_t text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT btrim(regexp_replace(lower(public.unaccent(regexp_replace(
    replace(replace(replace(replace(replace(COALESCE(_t,''), '&nbsp;', ' '), '&amp;', '&'), '&quot;', '"'), '&#39;', ''''), '&apos;', ''''),
    '<[^>]+>', ' ', 'g'))), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.acquire_person_source_lane_v1(_lane text, _seconds integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE tok uuid := gen_random_uuid(); got integer;
BEGIN
  INSERT INTO person_source_lane_leases(lane, token, lease_until, updated_at)
  VALUES (_lane, tok, now() + make_interval(secs => LEAST(GREATEST(COALESCE(_seconds,300),30),900)), now())
  ON CONFLICT (lane) DO UPDATE SET token = EXCLUDED.token, lease_until = EXCLUDED.lease_until, updated_at = now()
  WHERE person_source_lane_leases.lease_until IS NULL OR person_source_lane_leases.lease_until < now();
  GET DIAGNOSTICS got = ROW_COUNT;
  RETURN CASE WHEN got = 1 THEN tok END;
END $$;

CREATE OR REPLACE FUNCTION public.release_person_source_lane_v1(_lane text, _token uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE person_source_lane_leases SET lease_until = NULL, token = NULL, updated_at = now() WHERE lane = _lane AND token = _token
$$;

-- Mention rows left 'in_progress' by a retired judge with no open batch job behind them go back to the first round (audited).
CREATE OR REPLACE FUNCTION public.release_stale_person_mention_claims_v1(_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n integer := 0; r record;
BEGIN
  FOR r IN
    SELECT m.* FROM person_episode_mentions m
    WHERE m.relevance_status = 'in_progress'
      AND NOT EXISTS (SELECT 1 FROM person_relevance_work w JOIN person_relevance_batch_jobs j ON j.id = w.claim_token
        WHERE w.person_id = m.person_id AND w.episode_id = m.episode_id AND w.lease_until > now()
          AND j.status IN ('claimed','uploading','submitted','validating','in_progress','finalizing','cancelling','ingesting'))
      AND NOT EXISTS (SELECT 1 FROM person_relevance_batch_items i WHERE i.person_id = m.person_id AND i.episode_id = m.episode_id
          AND i.status IN ('queued','submitted') AND i.created_at > now() - interval '2 days')
  LOOP
    n := n + 1;
    IF NOT _dry_run THEN
      UPDATE person_episode_mentions SET relevance_status = 'pending' WHERE id = r.id AND relevance_status = 'in_progress';
      INSERT INTO person_pair_lane_audit(lane, action, person_id, episode_id, mention_id, rule_version, before_state, after_state, evidence)
      VALUES ('stale_claim', 'release_to_first_round', r.person_id, r.episode_id, r.id, 'stale-claim-v1',
        jsonb_build_object('relevance_status', 'in_progress', 'source', r.source, 'ai_judged_at', r.ai_judged_at),
        jsonb_build_object('relevance_status', 'pending'),
        jsonb_build_object('reason', 'no open batch job or live lease holds this row'));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('dry_run', _dry_run, 'rows', n);
END $$;

-- Show-level author credits from podcasts.hosts (the RSS author field the extractor copies to every episode).
CREATE OR REPLACE FUNCTION public.refresh_person_show_credits_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '170s' AS $$
DECLARE written integer;
BEGIN
  WITH pairs AS (
    SELECT m.person_id, m.podcast_id, count(DISTINCT m.episode_id) n_pairs,
      count(DISTINCT m.episode_id) FILTER (WHERE d.disposition IS NOT NULL AND d.reason_code NOT LIKE 'rss_author_credit%') n_text
    FROM person_episode_mentions m
    LEFT JOIN person_pair_dispositions d ON d.person_id = m.person_id AND d.episode_id = m.episode_id
    WHERE m.source = 'rss_author'
    GROUP BY 1, 2),
  src AS (
    SELECT pr.*, pe.name, p.hosts, p.title ptitle, p.description pdesc,
      public.person_text_fold_v1(pe.name) fname,
      public.person_text_fold_v1(concat_ws(' . ', p.title, p.description)) fshow,
      concat_ws(' . ', p.title, regexp_replace(COALESCE(p.description,''), '<[^>]+>', ' ', 'g')) rawshow
    FROM pairs pr JOIN people pe ON pe.id = pr.person_id JOIN podcasts p ON p.id = pr.podcast_id)
  INSERT INTO person_show_credits AS c (person_id, podcast_id, credit_kind, show_confirmed, show_quote, source_field, source_hash,
    rule_version, episode_pairs, episode_text_pairs, updated_at)
  SELECT person_id, podcast_id, 'rss_author_host', position(fname IN fshow) > 0,
    CASE WHEN position(fname IN fshow) > 0 THEN left(substr(rawshow, GREATEST(position(fname IN public.person_text_fold_v1(rawshow)) - 60, 1), 200), 200) END,
    'podcasts.hosts', md5(concat_ws('|', array_to_string(hosts, ','), md5(COALESCE(ptitle,'')), md5(COALESCE(pdesc,'')))),
    'show-credit-v1', n_pairs, n_text, now()
  FROM src
  ON CONFLICT (person_id, podcast_id, credit_kind) DO UPDATE SET show_confirmed = EXCLUDED.show_confirmed, show_quote = EXCLUDED.show_quote,
    source_hash = EXCLUDED.source_hash, episode_pairs = EXCLUDED.episode_pairs, episode_text_pairs = EXCLUDED.episode_text_pairs, updated_at = now()
  WHERE (c.source_hash, c.episode_pairs, c.episode_text_pairs, c.show_confirmed) IS DISTINCT FROM
        (EXCLUDED.source_hash, EXCLUDED.episode_pairs, EXCLUDED.episode_text_pairs, EXCLUDED.show_confirmed);
  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN jsonb_build_object('written', written, 'total', (SELECT count(*) FROM person_show_credits),
    'show_confirmed', (SELECT count(*) FROM person_show_credits WHERE show_confirmed));
END $$;

-- Identity anchor for the role-label lane. Name equality alone is never an anchor.
CREATE OR REPLACE FUNCTION public.person_role_label_anchor_v1(_person uuid, _podcast uuid, _quote text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN pe.wikidata_id IS NULL AND COALESCE(pe.wikipedia_match_status,'') <> 'verified'
      AND NOT EXISTS (SELECT 1 FROM person_episode_mentions m WHERE m.person_id = _person AND m.podcast_id <> _podcast)
      THEN jsonb_build_object('anchor', 'show_local_record', 'podcast_id', _podcast,
        'mentions_on_show', (SELECT count(*) FROM person_episode_mentions m WHERE m.person_id = _person))
    WHEN pe.wikipedia_match_status = 'verified' AND pe.wikidata_id IS NOT NULL AND w.word IS NOT NULL
      THEN jsonb_build_object('anchor', 'wiki_context', 'wikidata_id', pe.wikidata_id, 'descriptor', w.word,
        'wikipedia_description', left(pe.wikipedia_description, 200))
  END
  FROM people pe
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

-- Pair-level blockers shared by candidates and apply.
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
    WHEN COALESCE(pe.is_historical,false) OR (pe.date_of_death IS NOT NULL AND pe.date_of_death < e.published_at::date) THEN 'historical_person'
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

CREATE OR REPLACE FUNCTION public.person_role_label_source_hash_v1(_name text, _aliases text[], _title text, _description text, _page text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT md5(concat_ws('|', 'role-label-v1', _name, array_to_string(_aliases, ','), COALESCE(_title,''), md5(COALESCE(_description,'')), md5(COALESCE(_page,''))))
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.person_text_fold_v1(text)',
    'public.acquire_person_source_lane_v1(text, integer)',
    'public.release_person_source_lane_v1(text, uuid)',
    'public.release_stale_person_mention_claims_v1(boolean)',
    'public.refresh_person_show_credits_v1()',
    'public.person_role_label_anchor_v1(uuid, uuid, text)',
    'public.person_role_label_block_v1(uuid, uuid)',
    'public.person_role_label_source_hash_v1(text, text[], text, text, text)',
    'public.person_judge_source(uuid, uuid)'
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