SELECT cron.schedule(
  'ctr-snippet-optimizer-weekly',
  '25 6 * * 2',
  $$
  SELECT net.http_post(
    url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/ctr-snippet-optimizer',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
    body := '{"limit": 20}'::jsonb
  );
  $$
);