-- Public pages read organizations as anon, so a merged (hidden) duplicate row is invisible and its old URL
-- turned into a 404. This resolver exposes only the canonical public slug for a merged slug.
CREATE OR REPLACE FUNCTION public.resolve_org_redirect_v1(_slug text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT d.slug
    FROM public.organizations s
    JOIN public.organizations d ON d.id = s.ai_duplicate_of_organization_id
   WHERE s.slug = _slug AND d.is_public = true AND d.slug <> s.slug
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.resolve_org_redirect_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_org_redirect_v1(text) TO anon, authenticated, service_role;