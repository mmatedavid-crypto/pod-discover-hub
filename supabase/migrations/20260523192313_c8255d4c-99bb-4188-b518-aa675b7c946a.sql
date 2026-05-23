
CREATE TABLE IF NOT EXISTS public.queue_health_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner text NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  pending_now bigint,
  pending_prev bigint,
  pending_prev_prev bigint,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS queue_health_events_runner_idx ON public.queue_health_events(runner, created_at DESC);
ALTER TABLE public.queue_health_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read queue_health_events"
  ON public.queue_health_events FOR SELECT
  USING (public.has_role(auth.uid(),'admin'));
