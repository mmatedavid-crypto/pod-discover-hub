CREATE TABLE public.search_quality_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  ranking_version integer,
  judge_model text NOT NULL,
  calibration_model text,
  cost_cap_usd numeric(8,4) NOT NULL CHECK (cost_cap_usd > 0 AND cost_cap_usd <= 5),
  cost_used_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (cost_used_usd >= 0),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
GRANT SELECT ON public.search_quality_runs TO authenticated;
GRANT ALL ON public.search_quality_runs TO service_role;
ALTER TABLE public.search_quality_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read search quality runs" ON public.search_quality_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.search_quality_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.search_quality_runs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('search','recommendation')),
  query text NOT NULL,
  seed_episode_id uuid,
  query_type text,
  source text NOT NULL,
  split text NOT NULL CHECK (split IN ('dev','holdout')),
  calibrate boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','done','failed')),
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  results jsonb,
  judgments jsonb,
  calibration jsonb,
  metrics jsonb,
  diagnostics jsonb,
  latency_ms integer,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX search_quality_items_unique
  ON public.search_quality_items (run_id, kind, lower(query), coalesce(seed_episode_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX search_quality_items_claim ON public.search_quality_items (run_id, status, created_at);
GRANT SELECT ON public.search_quality_items TO authenticated;
GRANT ALL ON public.search_quality_items TO service_role;
ALTER TABLE public.search_quality_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read search quality items" ON public.search_quality_items
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Lease-based claim: pending rows, or claimed rows whose lease expired, max 3 attempts.
CREATE OR REPLACE FUNCTION public.claim_search_quality_items_v1(p_run_id uuid, p_limit integer, p_lease_seconds integer DEFAULT 300)
RETURNS SETOF public.search_quality_items
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH picked AS (
    SELECT i.id FROM public.search_quality_items i
    JOIN public.search_quality_runs r ON r.id = i.run_id AND r.status = 'open'
    WHERE i.run_id = p_run_id
      AND i.attempts < 3
      AND (i.status = 'pending' OR (i.status = 'claimed' AND i.lease_until < now()))
    ORDER BY i.created_at, i.id
    LIMIT greatest(1, least(coalesce(p_limit, 1), 20))
    FOR UPDATE OF i SKIP LOCKED
  )
  UPDATE public.search_quality_items i
     SET status = 'claimed', attempts = i.attempts + 1,
         lease_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 300), 900))),
         updated_at = now()
    FROM picked WHERE i.id = picked.id
  RETURNING i.*;
$$;

-- Atomic spend reservation against the run's hard cap. Returns false when it would exceed it.
CREATE OR REPLACE FUNCTION public.reserve_search_quality_cost_v1(p_run_id uuid, p_amount numeric)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    UPDATE public.search_quality_runs
       SET cost_used_usd = cost_used_usd + greatest(0, p_amount)
     WHERE id = p_run_id AND status = 'open'
       AND cost_used_usd + greatest(0, p_amount) <= cost_cap_usd
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM u);
$$;

-- Replace a reservation with the actual cost (delta may be negative; never below zero).
CREATE OR REPLACE FUNCTION public.settle_search_quality_cost_v1(p_run_id uuid, p_delta numeric)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.search_quality_runs
     SET cost_used_usd = greatest(0, cost_used_usd + coalesce(p_delta, 0))
   WHERE id = p_run_id;
$$;

REVOKE ALL ON FUNCTION public.claim_search_quality_items_v1(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_search_quality_cost_v1(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_search_quality_cost_v1(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_search_quality_items_v1(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_search_quality_cost_v1(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_search_quality_cost_v1(uuid, numeric) TO service_role;

INSERT INTO public.internal_job_tokens (job, token)
VALUES ('search-quality-eval', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (job) DO NOTHING;