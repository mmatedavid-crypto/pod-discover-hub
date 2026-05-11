-- Public storage bucket for branded Podiverzum social cards
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('social-cards', 'social-cards', true, 5242880, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read for everyone (X needs to fetch the image URL)
DROP POLICY IF EXISTS "social-cards public read" ON storage.objects;
CREATE POLICY "social-cards public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'social-cards');

-- Only admins or service role can write
DROP POLICY IF EXISTS "social-cards admin write" ON storage.objects;
CREATE POLICY "social-cards admin write"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'social-cards' AND (
    auth.role() = 'service_role' OR has_role(auth.uid(), 'admin'::app_role)
  )
);

DROP POLICY IF EXISTS "social-cards admin update" ON storage.objects;
CREATE POLICY "social-cards admin update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'social-cards' AND (
    auth.role() = 'service_role' OR has_role(auth.uid(), 'admin'::app_role)
  )
);