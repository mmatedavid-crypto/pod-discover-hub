-- Context only from accepted links (a pending/needs-review mention may be a homonym) and read the
-- organization evidence text out of its jsonb.
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
        (coalesce(p.host_count, 0) + coalesce(p.guest_count, 0) + coalesce(p.participant_count, 0)) AS participant_roles,
        EXISTS (SELECT 1 FROM people o WHERE o.normalized_name = p.normalized_name AND o.id <> p.id AND o.is_public) AS same_name_public,
        (SELECT coalesce(jsonb_agg(a.alias), '[]'::jsonb) FROM (SELECT alias FROM person_aliases WHERE person_id = p.id LIMIT 10) a) AS aliases,
        (SELECT coalesce(jsonb_agg(DISTINCT pc.title), '[]'::jsonb) FROM person_episode_mentions pm JOIN episodes e ON e.id = pm.episode_id
           JOIN podcasts pc ON pc.id = e.podcast_id WHERE pm.person_id = p.id AND pm.relevance_status = 'accepted') AS podcasts,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('title', q.title, 'evidence', left(q.evidence, 300), 'role', q.role_type, 'published_at', q.published_at)), '[]'::jsonb)
           FROM (SELECT e.title, pm.evidence, pm.role_type, e.published_at FROM person_episode_mentions pm JOIN episodes e ON e.id = pm.episode_id
                  WHERE pm.person_id = p.id AND pm.relevance_status = 'accepted'
                  ORDER BY e.published_at DESC NULLS LAST LIMIT 12) q) AS mentions,
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
        (SELECT coalesce(jsonb_agg(jsonb_build_object('title', q.title, 'evidence', left(q.ev, 300))), '[]'::jsonb)
           FROM (SELECT e.title, m.source_evidence->>'evidence' AS ev FROM episode_organization_map m JOIN episodes e ON e.id = m.episode_id
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