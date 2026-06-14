
-- people: restrict public SELECT to is_public rows
DROP POLICY IF EXISTS "people public read" ON public.people;
CREATE POLICY "people public read"
  ON public.people FOR SELECT
  USING (is_public = true OR has_role(auth.uid(), 'admin'::app_role));

-- organizations: restrict public SELECT to is_public rows
DROP POLICY IF EXISTS "organizations public read" ON public.organizations;
CREATE POLICY "organizations public read"
  ON public.organizations FOR SELECT
  USING (is_public = true OR has_role(auth.uid(), 'admin'::app_role));

-- Revoke internal editorial columns from anon/authenticated.
-- Admin reads go through service_role (sitemap/prerender) or admin RLS via authenticated; admins
-- typically use the service-role-backed admin pages, so revoking from authenticated is safe.
REVOKE SELECT (
  editorial_notes,
  ai_review_summary,
  ai_review_flags,
  ai_recommended_action,
  collision_signals,
  needs_human_review_identity,
  duplicate_candidate
) ON public.people FROM anon, authenticated;

REVOKE SELECT (
  editorial_notes,
  ai_review_summary,
  ai_review_flags,
  ai_recommended_action,
  ai_duplicate_of_organization_id,
  political_color,
  political_orientation
) ON public.organizations FROM anon, authenticated;
