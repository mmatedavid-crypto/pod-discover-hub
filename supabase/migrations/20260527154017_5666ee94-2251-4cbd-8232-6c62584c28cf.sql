
CREATE TABLE public.podcast_outreach_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  podcast_id uuid NOT NULL UNIQUE REFERENCES public.podcasts(id) ON DELETE CASCADE,
  owner_email text,
  owner_name text,
  extracted_from text,
  extract_status text NOT NULL DEFAULT 'pending',
  extract_error text,
  extracted_at timestamptz,
  outreach_status text NOT NULL DEFAULT 'not_sent',
  last_contacted_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_outreach_contacts_status ON public.podcast_outreach_contacts(outreach_status);
CREATE INDEX idx_outreach_contacts_extract ON public.podcast_outreach_contacts(extract_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.podcast_outreach_contacts TO authenticated;
GRANT ALL ON public.podcast_outreach_contacts TO service_role;

ALTER TABLE public.podcast_outreach_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read outreach contacts"
  ON public.podcast_outreach_contacts FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update outreach contacts"
  ON public.podcast_outreach_contacts FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert outreach contacts"
  ON public.podcast_outreach_contacts FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
