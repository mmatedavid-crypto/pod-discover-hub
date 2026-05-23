
CREATE TABLE public.landing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  anonymous_session_id text NOT NULL,
  event_name text NOT NULL,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_variant text,
  path text,
  referrer_domain text,
  device_type text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_landing_events_event_created ON public.landing_events (event_name, created_at DESC);
CREATE INDEX idx_landing_events_session ON public.landing_events (anonymous_session_id);
CREATE INDEX idx_landing_events_utm ON public.landing_events (utm_source, utm_campaign, created_at DESC);

ALTER TABLE public.landing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "landing_events public insert"
  ON public.landing_events FOR INSERT
  WITH CHECK (true);

CREATE POLICY "landing_events admin read"
  ON public.landing_events FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));
