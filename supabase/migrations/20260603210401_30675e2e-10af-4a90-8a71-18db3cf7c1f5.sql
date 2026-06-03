SELECT cron.schedule(
  'reddit-link-bot',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url:='https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/reddit-link-bot',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;$$
);