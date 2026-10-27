-- Second-pass candidates: organizations the first pass sent to review because the exact-name
-- article was a disambiguation page or the wrong thing, still unmatched and not yet tried by _policy.
CREATE OR REPLACE FUNCTION public.wiki_safe_resolve_candidates_v1(_limit integer, _base_policy text, _policy text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '20s'
AS $$
DECLARE v jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(c), '[]'::jsonb) INTO v FROM (
    SELECT o.id, o.name, o.org_type, o.gated_episode_count, b.reason AS base_reason,
      b.candidate->>'wikipedia_title' AS rejected_title,
      (SELECT coalesce(jsonb_agg(a.alias), '[]'::jsonb) FROM (SELECT alias FROM organization_aliases WHERE organization_id = o.id LIMIT 10) a) AS aliases,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('title', q.title, 'evidence', left(q.ev, 300))), '[]'::jsonb)
         FROM (SELECT e.title, m.source_evidence->>'evidence' AS ev FROM episode_organization_map m JOIN episodes e ON e.id = m.episode_id
                WHERE m.organization_id = o.id ORDER BY e.published_at DESC NULLS LAST LIMIT 12) q) AS mentions
    FROM wiki_safe_match_log b
    JOIN organizations o ON o.id = b.entity_id
    WHERE b.entity_kind = 'organization' AND b.policy_version = _base_policy AND b.decision = 'review'
      AND b.reason IN ('type_mismatch', 'disambiguation_page')
      AND o.is_indexable AND o.wikipedia_match_status IN ('no_match', 'unchecked') AND o.quality_hold_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM wiki_safe_match_log l WHERE l.entity_kind = 'organization' AND l.entity_id = o.id AND l.policy_version = _policy)
    ORDER BY o.gated_episode_count DESC NULLS LAST, o.id
    LIMIT LEAST(GREATEST(_limit, 1), 100)) c;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.wiki_safe_resolve_candidates_v1(integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wiki_safe_resolve_candidates_v1(integer, text, text) TO service_role;