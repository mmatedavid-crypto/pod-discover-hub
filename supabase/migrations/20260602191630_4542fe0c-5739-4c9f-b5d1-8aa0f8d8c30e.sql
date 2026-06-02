GRANT SELECT ON public.editorial_posts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.editorial_posts TO authenticated;
GRANT ALL ON public.editorial_posts TO service_role;