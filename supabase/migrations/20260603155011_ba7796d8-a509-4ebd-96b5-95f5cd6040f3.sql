-- 1. taste_cards: hide proprietary prompt column from public roles
REVOKE SELECT (hidden_embedding_prompt) ON public.taste_cards FROM anon, authenticated;

-- 2. podcast_outreach_contacts: lock down to admins/service_role only and add DELETE policy
REVOKE ALL ON public.podcast_outreach_contacts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.podcast_outreach_contacts TO authenticated;
GRANT ALL ON public.podcast_outreach_contacts TO service_role;

DROP POLICY IF EXISTS "Admins can delete outreach contacts" ON public.podcast_outreach_contacts;
CREATE POLICY "Admins can delete outreach contacts"
ON public.podcast_outreach_contacts
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));