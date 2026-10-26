-- Free, AI-free Wikipedia matching for people and organizations. Only "safe" matches are applied
-- (exact huwiki article, right Wikidata type, context evidence, no contradicting dates); everything
-- else is logged for owner review. Every applied change keeps its before-state for undo.
CREATE TABLE IF NOT EXISTS public.wiki_safe_match_log (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL,
  policy_version text NOT NULL,
  entity_kind text NOT NULL CHECK (entity_kind IN ('person', 'organization')),
  entity_id uuid NOT NULL,
  entity_name text,
  decision text NOT NULL CHECK (decision IN ('accept', 'review', 'no_article', 'skip', 'error')),
  reason text,
  candidate jsonb,
  before jsonb,
  applied boolean NOT NULL DEFAULT false,
  reverted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_kind, entity_id, policy_version)
);
GRANT ALL ON public.wiki_safe_match_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.wiki_safe_match_log_id_seq TO service_role;
ALTER TABLE public.wiki_safe_match_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read wiki safe match log" ON public.wiki_safe_match_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.wiki_safe_match_log TO authenticated;

-- Candidates: indexable entities without a Wikipedia match, most-featured first, not yet seen
-- by this policy version, with public context (podcast/episode titles, mention evidence).
CREATE OR REPLACE FUNCTION public.wiki_safe_match_candidates_v1(_kind text, _limit integer, _policy text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '20s'
AS $$
DECLARE v jsonb;
BEGIN
  IF _kind = 'person' THEN
    SELECT coalesce(jsonb_agg(c), '[]'::jsonb) INTO v FROM (
      SELECT p.id, p.name, p.normalized_name, p.gated_episode_count,
        (p.host_count + p.guest_count + p.participant_count) AS participant_roles,
        EXISTS (SELECT 1 FROM people o WHERE o.normalized_name = p.normalized_name AND o.id <> p.id AND o.is_public) AS same_name_public,
        (SELECT coalesce(jsonb_agg(a.alias), '[]'::jsonb) FROM (SELECT alias FROM person_aliases WHERE person_id = p.id LIMIT 10) a) AS aliases,
        (SELECT coalesce(jsonb_agg(DISTINCT pc.title), '[]'::jsonb) FROM person_podcast_map m JOIN podcasts pc ON pc.id = m.podcast_id WHERE m.person_id = p.id) AS podcasts,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('title', q.title, 'evidence', left(q.evidence, 300), 'role', q.role_type, 'published_at', q.published_at)), '[]'::jsonb)
           FROM (SELECT e.title, pm.evidence, pm.role_type, e.published_at FROM person_episode_mentions pm JOIN episodes e ON e.id = pm.episode_id
                  WHERE pm.person_id = p.id AND pm.relevance_status IN ('accepted', 'pending', 'needs_review')
                  ORDER BY (pm.relevance_status = 'accepted') DESC, e.published_at DESC NULLS LAST LIMIT 12) q) AS mentions,
        (SELECT min(e.published_at) FROM person_episode_mentions pm JOIN episodes e ON e.id = pm.episode_id
          WHERE pm.person_id = p.id AND pm.relevance_status = 'accepted' AND pm.role_type = 'participant') AS first_participant_at
      FROM people p
      WHERE p.is_indexable AND p.wikipedia_match_status IN ('no_match', 'unchecked')
        AND NOT coalesce(p.identity_ambiguous, false) AND NOT coalesce(p.duplicate_candidate, false)
        AND NOT EXISTS (SELECT 1 FROM wiki_safe_match_log l WHERE l.entity_kind = 'person' AND l.entity_id = p.id AND l.policy_version = _policy)
      ORDER BY p.gated_episode_count DESC NULLS LAST, p.id
      LIMIT LEAST(GREATEST(_limit, 1), 200)) c;
  ELSIF _kind = 'organization' THEN
    SELECT coalesce(jsonb_agg(c), '[]'::jsonb) INTO v FROM (
      SELECT o.id, o.name, o.org_type, o.gated_episode_count,
        (SELECT coalesce(jsonb_agg(a.alias), '[]'::jsonb) FROM (SELECT alias FROM organization_aliases WHERE organization_id = o.id LIMIT 10) a) AS aliases,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('title', q.title, 'evidence', left(q.source_evidence, 300))), '[]'::jsonb)
           FROM (SELECT e.title, m.source_evidence FROM episode_organization_map m JOIN episodes e ON e.id = m.episode_id
                  WHERE m.organization_id = o.id ORDER BY e.published_at DESC NULLS LAST LIMIT 12) q) AS mentions
      FROM organizations o
      WHERE o.is_indexable AND o.wikipedia_match_status IN ('no_match', 'unchecked') AND o.quality_hold_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM wiki_safe_match_log l WHERE l.entity_kind = 'organization' AND l.entity_id = o.id AND l.policy_version = _policy)
      ORDER BY o.gated_episode_count DESC NULLS LAST, o.id
      LIMIT LEAST(GREATEST(_limit, 1), 200)) c;
  ELSE
    RAISE EXCEPTION 'unknown kind %', _kind;
  END IF;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.wiki_safe_match_candidates_v1(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wiki_safe_match_candidates_v1(text, integer, text) TO service_role;

-- Apply one safe match: only while the row is still unmatched, only allowlisted columns, and
-- only fills an image/logo that is empty. The before-state goes to the log for undo.
CREATE OR REPLACE FUNCTION public.apply_wiki_safe_match_v1(_kind text, _id uuid, _patch jsonb, _run_id text, _policy text, _reason text, _candidate jsonb)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_before jsonb; v_status text; v_name text;
BEGIN
  IF _kind = 'person' THEN
    SELECT wikipedia_match_status, name, jsonb_build_object(
        'wikipedia_title', wikipedia_title, 'wikipedia_url', wikipedia_url, 'wikidata_id', wikidata_id,
        'wikipedia_extract', wikipedia_extract, 'wikipedia_description', wikipedia_description,
        'wikipedia_match_status', wikipedia_match_status, 'wikipedia_match_confidence', wikipedia_match_confidence,
        'wikipedia_match_evidence', wikipedia_match_evidence, 'wiki_match_reason', wiki_match_reason, 'wiki_match_run_at', wiki_match_run_at,
        'image_url', image_url, 'image_original_url', image_original_url, 'image_source', image_source, 'image_license', image_license,
        'image_license_url', image_license_url, 'image_author', image_author, 'image_attribution', image_attribution,
        'image_status', image_status, 'image_checked_at', image_checked_at)
      INTO v_status, v_name, v_before FROM people WHERE id = _id FOR UPDATE;
    IF v_status IS NULL OR v_status NOT IN ('no_match', 'unchecked') THEN RETURN 'skip:status_changed'; END IF;
    UPDATE people SET
      wikipedia_title = _patch->>'wikipedia_title', wikipedia_url = _patch->>'wikipedia_url', wikidata_id = _patch->>'wikidata_id',
      wikipedia_extract = _patch->>'wikipedia_extract', wikipedia_description = _patch->>'wikipedia_description',
      wikipedia_match_status = 'verified', wikipedia_match_confidence = (_patch->>'wikipedia_match_confidence')::numeric,
      wikipedia_match_evidence = _patch->'wikipedia_match_evidence', wiki_match_reason = _reason, wiki_match_run_at = now(),
      image_url = CASE WHEN image_url IS NULL AND _patch ? 'image_url' THEN _patch->>'image_url' ELSE image_url END,
      image_original_url = CASE WHEN image_url IS NULL AND _patch ? 'image_url' THEN _patch->>'image_original_url' ELSE image_original_url END,
      image_source = CASE WHEN image_url IS NULL AND _patch ? 'image_url' THEN 'wikimedia_commons' ELSE image_source END,
      image_license = CASE WHEN image_url IS NULL AND _patch ? 'image_url' THEN _patch->>'image_license' ELSE image_license END,
      image_license_url = CASE WHEN image_url IS NULL AND _patch ? 'image_url' THEN _patch->>'image_license_url' ELSE image_license_url END,
      image_author = CASE WHEN image_url IS NULL AND _patch ? 'image_url' THEN _patch->>'image_author' ELSE image_author END,
      image_attribution = CASE WHEN image_url IS NULL AND _patch ? 'image_url' THEN _patch->>'image_attribution' ELSE image_attribution END,
      image_status = CASE WHEN image_url IS NULL AND _patch ? 'image_url' THEN 'cached' ELSE image_status END,
      image_checked_at = CASE WHEN image_url IS NULL AND _patch ? 'image_url' THEN now() ELSE image_checked_at END,
      updated_at = now()
    WHERE id = _id;
  ELSIF _kind = 'organization' THEN
    SELECT wikipedia_match_status, name, jsonb_build_object(
        'wikipedia_title', wikipedia_title, 'wikipedia_url', wikipedia_url, 'wikidata_id', wikidata_id,
        'wikipedia_extract', wikipedia_extract, 'wikipedia_description', wikipedia_description,
        'wikipedia_match_status', wikipedia_match_status, 'wikipedia_match_confidence', wikipedia_match_confidence,
        'wikipedia_match_evidence', wikipedia_match_evidence, 'wiki_match_reason', wiki_match_reason, 'wiki_match_run_at', wiki_match_run_at,
        'logo_url', logo_url, 'logo_source', logo_source, 'logo_license', logo_license, 'logo_attribution', logo_attribution)
      INTO v_status, v_name, v_before FROM organizations WHERE id = _id FOR UPDATE;
    IF v_status IS NULL OR v_status NOT IN ('no_match', 'unchecked') THEN RETURN 'skip:status_changed'; END IF;
    UPDATE organizations SET
      wikipedia_title = _patch->>'wikipedia_title', wikipedia_url = _patch->>'wikipedia_url', wikidata_id = _patch->>'wikidata_id',
      wikipedia_extract = _patch->>'wikipedia_extract', wikipedia_description = _patch->>'wikipedia_description',
      wikipedia_match_status = 'verified', wikipedia_match_confidence = (_patch->>'wikipedia_match_confidence')::numeric,
      wikipedia_match_evidence = _patch->'wikipedia_match_evidence', wiki_match_reason = _reason, wiki_match_run_at = now(),
      logo_url = CASE WHEN logo_url IS NULL AND _patch ? 'image_url' THEN _patch->>'image_url' ELSE logo_url END,
      logo_source = CASE WHEN logo_url IS NULL AND _patch ? 'image_url' THEN 'wikimedia_commons' ELSE logo_source END,
      logo_license = CASE WHEN logo_url IS NULL AND _patch ? 'image_url' THEN _patch->>'image_license' ELSE logo_license END,
      logo_attribution = CASE WHEN logo_url IS NULL AND _patch ? 'image_url' THEN _patch->>'image_attribution' ELSE logo_attribution END,
      updated_at = now()
    WHERE id = _id;
  ELSE
    RAISE EXCEPTION 'unknown kind %', _kind;
  END IF;
  INSERT INTO wiki_safe_match_log (run_id, policy_version, entity_kind, entity_id, entity_name, decision, reason, candidate, before, applied)
  VALUES (_run_id, _policy, _kind, _id, v_name, 'accept', _reason, _candidate, v_before, true)
  ON CONFLICT (entity_kind, entity_id, policy_version) DO NOTHING;
  RETURN 'applied';
END;
$$;
REVOKE ALL ON FUNCTION public.apply_wiki_safe_match_v1(text, uuid, jsonb, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_wiki_safe_match_v1(text, uuid, jsonb, text, text, text, jsonb) TO service_role;

-- Undo applied matches of one run (or one entity) while the row still carries the applied match.
CREATE OR REPLACE FUNCTION public.revert_wiki_safe_match_v1(_run_id text, _entity_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record; n integer := 0; b jsonb;
BEGIN
  FOR r IN SELECT * FROM wiki_safe_match_log WHERE applied AND reverted_at IS NULL
             AND (run_id = _run_id OR _run_id IS NULL) AND (_entity_id IS NULL OR entity_id = _entity_id) FOR UPDATE LOOP
    b := r.before;
    IF r.entity_kind = 'person' THEN
      UPDATE people SET wikipedia_title = b->>'wikipedia_title', wikipedia_url = b->>'wikipedia_url', wikidata_id = b->>'wikidata_id',
        wikipedia_extract = b->>'wikipedia_extract', wikipedia_description = b->>'wikipedia_description',
        wikipedia_match_status = b->>'wikipedia_match_status', wikipedia_match_confidence = (b->>'wikipedia_match_confidence')::numeric,
        wikipedia_match_evidence = b->'wikipedia_match_evidence', wiki_match_reason = b->>'wiki_match_reason',
        wiki_match_run_at = (b->>'wiki_match_run_at')::timestamptz,
        image_url = b->>'image_url', image_original_url = b->>'image_original_url', image_source = b->>'image_source',
        image_license = b->>'image_license', image_license_url = b->>'image_license_url', image_author = b->>'image_author',
        image_attribution = b->>'image_attribution', image_status = b->>'image_status', image_checked_at = (b->>'image_checked_at')::timestamptz,
        updated_at = now()
      WHERE id = r.entity_id AND wikipedia_title IS NOT DISTINCT FROM r.candidate->>'wikipedia_title';
    ELSE
      UPDATE organizations SET wikipedia_title = b->>'wikipedia_title', wikipedia_url = b->>'wikipedia_url', wikidata_id = b->>'wikidata_id',
        wikipedia_extract = b->>'wikipedia_extract', wikipedia_description = b->>'wikipedia_description',
        wikipedia_match_status = b->>'wikipedia_match_status', wikipedia_match_confidence = (b->>'wikipedia_match_confidence')::numeric,
        wikipedia_match_evidence = b->'wikipedia_match_evidence', wiki_match_reason = b->>'wiki_match_reason',
        wiki_match_run_at = (b->>'wiki_match_run_at')::timestamptz,
        logo_url = b->>'logo_url', logo_source = b->>'logo_source', logo_license = b->>'logo_license', logo_attribution = b->>'logo_attribution',
        updated_at = now()
      WHERE id = r.entity_id AND wikipedia_title IS NOT DISTINCT FROM r.candidate->>'wikipedia_title';
    END IF;
    IF FOUND THEN n := n + 1; END IF;
    UPDATE wiki_safe_match_log SET reverted_at = now() WHERE id = r.id;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.revert_wiki_safe_match_v1(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revert_wiki_safe_match_v1(text, uuid) TO service_role;