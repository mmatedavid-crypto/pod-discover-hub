
-- beta_feedback
CREATE TABLE public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  message text not null check (length(message) between 1 and 4000),
  email text check (email is null or length(email) <= 320),
  page_url text,
  viewport text,
  user_agent text,
  search_query text,
  user_id uuid,
  handled boolean not null default false,
  created_at timestamptz not null default now()
);
ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can submit feedback"
  ON public.beta_feedback FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "admins read feedback"
  ON public.beta_feedback FOR SELECT
  TO public
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins update feedback"
  ON public.beta_feedback FOR UPDATE
  TO public
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins delete feedback"
  ON public.beta_feedback FOR DELETE
  TO public
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX beta_feedback_created_idx ON public.beta_feedback (created_at DESC);

-- search_events
CREATE TABLE public.search_events (
  id uuid primary key default gen_random_uuid(),
  query text not null check (length(query) between 1 and 200),
  terms_count integer not null default 0,
  result_count integer not null default 0,
  fallback_used boolean not null default false,
  viewport_width integer,
  user_id uuid,
  created_at timestamptz not null default now()
);
ALTER TABLE public.search_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can log search"
  ON public.search_events FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "admins read search events"
  ON public.search_events FOR SELECT
  TO public
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX search_events_created_idx ON public.search_events (created_at DESC);
CREATE INDEX search_events_query_idx ON public.search_events (lower(query));
