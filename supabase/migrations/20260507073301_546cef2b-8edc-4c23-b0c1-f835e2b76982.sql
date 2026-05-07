SELECT cron.schedule(
  'growth-autopilot-every-10-min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url:='https://iqzkayoqqagowvxeaphe.supabase.co/functions/v1/growth-autopilot',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxemtheW9xcWFnb3d2eGVhcGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDA3NzAsImV4cCI6MjA5MzU3Njc3MH0.KaeRcYcljGjrP_OAcTp_lapPSRsAYRq6gPJ2vYV7fz4"}'::jsonb,
    body:='{"trigger":"cron"}'::jsonb
  );
  $$
);