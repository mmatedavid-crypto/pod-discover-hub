INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'news_sitemap_refresh_controls',
  jsonb_build_object(
    'enabled', true,
    'cadence_minutes', 15,
    'mode', 'refresh_sitemap_lite',
    'google_submit_policy', 'submit_only_when_news_sitemap_hash_changes',
    'requires_google_secrets', jsonb_build_array(
      'GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL',
      'GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY',
      'GOOGLE_SEARCH_CONSOLE_SITE_URL'
    ),
    'note', 'Refreshes sitemap lite every 15 minutes; refresh-sitemap submits news-sitemap.xml to Google Search Console only when the generated XML hash changes.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-refresh-sitemap-lite-15min') THEN
    PERFORM cron.unschedule('podiverzum-refresh-sitemap-lite-15min');
  END IF;

  -- Retire the older daily/lite job name if it exists; the 15-minute job is
  -- cheap because it only rewrites small sitemap groups and Google submit is
  -- hash-gated in the edge function.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-refresh-sitemap-lite-daily') THEN
    PERFORM cron.unschedule('podiverzum-refresh-sitemap-lite-daily');
  END IF;

  PERFORM cron.schedule(
    'podiverzum-refresh-sitemap-lite-15min',
    '*/15 * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/refresh-sitemap?type=lite',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
      body := concat('{"trigger":"news_sitemap_fast_refresh","ts":"', now(), '"}')::jsonb
    );
    $cmd$
  );
END $$;
