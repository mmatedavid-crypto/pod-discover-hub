
CREATE TABLE IF NOT EXISTS public.gsc_weekly_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL,
  week_end date NOT NULL,
  site_url text NOT NULL,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  deltas jsonb NOT NULL DEFAULT '{}'::jsonb,
  top_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  rising_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  falling_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  striking_distance jsonb NOT NULL DEFAULT '[]'::jsonb,
  zero_click_high_impr jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_summary text,
  ai_recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_model text,
  raw_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_url, week_start)
);
GRANT SELECT ON public.gsc_weekly_insights TO authenticated;
GRANT ALL ON public.gsc_weekly_insights TO service_role;
ALTER TABLE public.gsc_weekly_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read gsc_weekly_insights" ON public.gsc_weekly_insights FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.gsc_query_daily (
  id bigserial PRIMARY KEY,
  site_url text NOT NULL,
  date date NOT NULL,
  query text NOT NULL,
  page text NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  ctr double precision NOT NULL DEFAULT 0,
  position double precision NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_url, date, query, page)
);
GRANT SELECT ON public.gsc_query_daily TO authenticated;
GRANT ALL ON public.gsc_query_daily TO service_role;
ALTER TABLE public.gsc_query_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read gsc_query_daily" ON public.gsc_query_daily FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS gsc_query_daily_site_date_idx ON public.gsc_query_daily (site_url, date DESC);
CREATE INDEX IF NOT EXISTS gsc_query_daily_query_idx ON public.gsc_query_daily (query);
