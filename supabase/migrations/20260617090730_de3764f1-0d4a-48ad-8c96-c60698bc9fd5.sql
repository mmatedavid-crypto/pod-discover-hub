
-- 1. entities: filter public reads
DROP POLICY IF EXISTS "entities public read" ON public.entities;
CREATE POLICY "entities public read"
ON public.entities
FOR SELECT
USING (is_public = true);

-- 2. live_events: add admin-read policy; no INSERT policy (service_role bypasses RLS)
CREATE POLICY "live_events admin read"
ON public.live_events
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- 3. profiles: revoke sensitive embedding column from client roles
REVOKE SELECT (taste_vec) ON public.profiles FROM anon, authenticated;
