
-- Public sitemap bucket: world-readable XML, service-role-only writes.
INSERT INTO storage.buckets (id, name, public)
VALUES ('sitemaps', 'sitemaps', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read
DROP POLICY IF EXISTS "Sitemaps are publicly readable" ON storage.objects;
CREATE POLICY "Sitemaps are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'sitemaps');

-- service_role bypasses RLS, so no insert/update/delete policy needed for the cron path.
