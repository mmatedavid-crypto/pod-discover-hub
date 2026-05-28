
CREATE TABLE IF NOT EXISTS public.ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner text NOT NULL,
  model text,
  cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_runs_runner_day ON public.ai_runs(runner, created_at DESC);

GRANT SELECT ON public.ai_runs TO authenticated;
GRANT ALL ON public.ai_runs TO service_role;

ALTER TABLE public.ai_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_runs_admin_read" ON public.ai_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
