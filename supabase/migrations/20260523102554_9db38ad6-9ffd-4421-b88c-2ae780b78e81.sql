select cron.alter_job(48, schedule => '*/1 * * * *', command => $cmd$
  SELECT net.http_post(
    url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/organization-wikimedia-enricher',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
    body := '{"limit":75}'::jsonb
  );
$cmd$);

select cron.alter_job(43, schedule => '*/1 * * * *', command => $cmd$
  SELECT net.http_post(
    url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/person-bio-generator',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
    body := '{"limit": 25, "daily_budget_usd": 20}'::jsonb
  );
$cmd$);

select cron.alter_job(37, schedule => '*/2 * * * *', command => $cmd$
  SELECT net.http_post(
    url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/person-wikimedia-enricher',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWд6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
    body := '{"limit":50}'::jsonb
  );
$cmd$);