CREATE POLICY "Public can view published editorial posts"
ON public.editorial_posts
FOR SELECT
TO anon, authenticated
USING (status = 'published');