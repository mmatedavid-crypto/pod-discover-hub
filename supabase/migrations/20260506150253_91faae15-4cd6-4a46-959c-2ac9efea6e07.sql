CREATE TABLE public.page_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path text NOT NULL,
  full_url text,
  referrer text,
  viewport_width integer,
  user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_page_events_created_at ON public.page_events(created_at DESC);
CREATE INDEX idx_page_events_path ON public.page_events(path);

ALTER TABLE public.page_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can log page view"
  ON public.page_events FOR INSERT
  WITH CHECK (true);

CREATE POLICY "admins read page events"
  ON public.page_events FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));