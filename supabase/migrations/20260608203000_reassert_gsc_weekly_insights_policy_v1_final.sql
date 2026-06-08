-- Final Google Search Console weekly insights policy.
-- Makes the GSC weekly insight runner deploy-visible: table contracts, admin-only
-- read surface, connector-secret policy, and weekly cron metadata are explicit.

ALTER TABLE public.gsc_weekly_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_query_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read gsc_weekly_insights" ON public.gsc_weekly_insights;
CREATE POLICY "admins read gsc_weekly_insights"
  ON public.gsc_weekly_insights
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admins read gsc_query_daily" ON public.gsc_query_daily;
CREATE POLICY "admins read gsc_query_daily"
  ON public.gsc_query_daily
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.gsc_weekly_insights TO authenticated;
GRANT ALL ON public.gsc_weekly_insights TO service_role;
GRANT SELECT ON public.gsc_query_daily TO authenticated;
GRANT ALL ON public.gsc_query_daily TO service_role;

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
  value = public.app_settings.value
    || jsonb_build_object(
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

DO $$
DECLARE
  v_controls jsonb;
  v_weekly_rls boolean;
  v_daily_rls boolean;
BEGIN
  SELECT value INTO v_controls
  FROM public.app_settings
  WHERE key = 'gsc_weekly_insights_controls';

  SELECT relrowsecurity INTO v_weekly_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'gsc_weekly_insights';

  SELECT relrowsecurity INTO v_daily_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'gsc_query_daily';

  IF COALESCE(v_controls->>'policy', '') <> 'weekly_gsc_insights_connector_ai_summary_v1'
     OR COALESCE(v_controls->>'site_url', '') <> 'sc-domain:podiverzum.hu'
     OR COALESCE(v_controls->>'cron_job', '') <> 'podiverzum-gsc-weekly-insights'
     OR COALESCE(v_controls->>'cron_schedule', '') <> '10 6 * * 1'
     OR NOT (v_controls->'requires_connector_secrets' ? 'LOVABLE_API_KEY')
     OR NOT (v_controls->'requires_connector_secrets' ? 'GOOGLE_SEARCH_CONSOLE_API_KEY') THEN
    RAISE EXCEPTION 'gsc_weekly_insights_controls policy/cron/secret contract is incomplete';
  END IF;

  IF COALESCE(v_weekly_rls, false) IS DISTINCT FROM true
     OR COALESCE(v_daily_rls, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'GSC weekly insights tables must keep RLS enabled';
  END IF;
END $$;
