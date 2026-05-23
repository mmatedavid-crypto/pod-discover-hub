
CREATE TABLE public.landing_email_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL,
  anonymous_session_id text,
  source text NOT NULL DEFAULT 'swipe_result',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  archetype_slug text,
  confirmed boolean NOT NULL DEFAULT false,
  unsubscribed_at timestamptz
);

CREATE UNIQUE INDEX idx_landing_email_signups_email ON public.landing_email_signups (lower(email));
CREATE INDEX idx_landing_email_signups_created ON public.landing_email_signups (created_at DESC);

ALTER TABLE public.landing_email_signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "landing_email_signups public insert"
  ON public.landing_email_signups FOR INSERT
  WITH CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

CREATE POLICY "landing_email_signups admin read"
  ON public.landing_email_signups FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "landing_email_signups admin write"
  ON public.landing_email_signups FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
