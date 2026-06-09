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
DROP POLICY IF EXISTS "admins read gsc_weekly_insights" ON public.gsc_weekly_insights;
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
DROP POLICY IF EXISTS "admins read gsc_query_daily" ON public.gsc_query_daily;
CREATE POLICY "admins read gsc_query_daily" ON public.gsc_query_daily FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS gsc_query_daily_site_date_idx ON public.gsc_query_daily (site_url, date DESC);
CREATE INDEX IF NOT EXISTS gsc_query_daily_query_idx ON public.gsc_query_daily (query);

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'gsc_weekly_insights_controls',
  jsonb_build_object(
    'enabled', true,
    'policy', 'weekly_gsc_insights_connector_ai_summary_v1',
    'site_url', 'sc-domain:podiverzum.hu',
    'cron_job', 'podiverzum-gsc-weekly-insights',
    'cron_schedule', '10 6 * * 1',
    'data_lag_days', 3,
    'current_window_days', 7,
    'previous_window_days', 7,
    'submit_transport', 'lovable_google_search_console_connector_gateway',
    'requires_connector_secrets', jsonb_build_array('LOVABLE_API_KEY', 'GOOGLE_SEARCH_CONSOLE_API_KEY'),
    'ai_summary_enabled', true,
    'ai_job_type', 'gsc_weekly_insights',
    'admin_route', '/admin/gsc-insights',
    'manual_run_allowed', true,
    'reasserted_by', '20260608203000_reassert_gsc_weekly_insights_policy_v1_final'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = public.app_settings.value || jsonb_build_object(
    'enabled', COALESCE(public.app_settings.value->'enabled', 'true'::jsonb),
    'policy', 'weekly_gsc_insights_connector_ai_summary_v1',
    'site_url', 'sc-domain:podiverzum.hu',
    'cron_job', 'podiverzum-gsc-weekly-insights',
    'cron_schedule', '10 6 * * 1',
    'data_lag_days', 3,
    'current_window_days', 7,
    'previous_window_days', 7,
    'submit_transport', 'lovable_google_search_console_connector_gateway',
    'requires_connector_secrets', jsonb_build_array('LOVABLE_API_KEY', 'GOOGLE_SEARCH_CONSOLE_API_KEY'),
    'ai_summary_enabled', true,
    'ai_job_type', 'gsc_weekly_insights',
    'admin_route', '/admin/gsc-insights',
    'manual_run_allowed', true,
    'reasserted_by', '20260608203000_reassert_gsc_weekly_insights_policy_v1_final'
  ),
  updated_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-gsc-weekly-insights') THEN
    PERFORM cron.unschedule('podiverzum-gsc-weekly-insights');
  END IF;
  PERFORM cron.schedule(
    'podiverzum-gsc-weekly-insights',
    '10 6 * * 1',
    $cmd$
    SELECT net.http_post(
      url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/gsc-weekly-insights',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
      body := concat('{"trigger":"cron","ts":"', now(), '"}')::jsonb
    );
    $cmd$
  );
END $$;