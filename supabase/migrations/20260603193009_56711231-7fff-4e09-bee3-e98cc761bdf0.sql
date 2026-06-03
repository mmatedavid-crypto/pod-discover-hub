DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-refresh-sitemap-lite-15min') THEN
    PERFORM cron.unschedule('podiverzum-refresh-sitemap-lite-15min');
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

DO $$
BEGIN
  IF to_regclass('public.episode_article_candidates') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.episode_article_candidates TO authenticated;
    GRANT ALL ON public.episode_article_candidates TO service_role;
  END IF;
END $$;