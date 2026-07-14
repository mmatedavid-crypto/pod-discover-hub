
CREATE TABLE public.prefetch_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  podcast_slug text NOT NULL,
  podcast_title text NOT NULL,
  rank_label text,
  cadence_per_week numeric NOT NULL DEFAULT 0,
  cadence_pattern text,
  episodes_last_60d int NOT NULL DEFAULT 0,
  gsc_impressions_28d int NOT NULL DEFAULT 0,
  gsc_clicks_28d int NOT NULL DEFAULT 0,
  gsc_avg_position numeric,
  gsc_top_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  trend_related_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  trend_rising_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  gap_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority_score numeric NOT NULL DEFAULT 0,
  suggested_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(podcast_id)
);

CREATE INDEX idx_prefetch_targets_priority ON public.prefetch_targets(priority_score DESC);
CREATE INDEX idx_prefetch_targets_cadence ON public.prefetch_targets(cadence_per_week DESC);

GRANT ALL ON public.prefetch_targets TO service_role;

ALTER TABLE public.prefetch_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view prefetch_targets"
ON public.prefetch_targets FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages prefetch_targets"
ON public.prefetch_targets FOR ALL
TO service_role
USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.tg_prefetch_targets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER prefetch_targets_updated_at
BEFORE UPDATE ON public.prefetch_targets
FOR EACH ROW EXECUTE FUNCTION public.tg_prefetch_targets_updated_at();
