CREATE OR REPLACE FUNCTION public.get_linkable_entities(
  p_people text[] DEFAULT ARRAY[]::text[],
  p_organizations text[] DEFAULT ARRAY[]::text[]
)
RETURNS TABLE(kind text, slug text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'person'::text AS kind, p.slug
  FROM public.people p
  WHERE p.slug = ANY(COALESCE(p_people, ARRAY[]::text[]))
    AND p.is_public IS TRUE
    AND p.gated_episode_count >= 1
    AND COALESCE(p.activation_status, '') <> 'inactive'
    AND COALESCE(p.ai_recommended_action, '') NOT IN ('hide', 'reject')
    AND COALESCE(p.ai_review_status, '') NOT IN ('needs_human_review', 'duplicate_candidate')
    AND COALESCE(p.identity_status, '') <> 'split_resolved'
  UNION ALL
  SELECT 'company'::text AS kind, o.slug
  FROM public.organizations o
  WHERE o.slug = ANY(COALESCE(p_organizations, ARRAY[]::text[]))
    AND o.is_public IS TRUE
    AND o.gated_episode_count >= 1;
$$;

REVOKE ALL ON FUNCTION public.get_linkable_entities(text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_linkable_entities(text[], text[]) TO anon, authenticated, service_role;