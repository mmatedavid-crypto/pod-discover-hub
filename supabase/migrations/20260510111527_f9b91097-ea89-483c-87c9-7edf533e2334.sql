
SELECT cron.alter_job(
  job_id := 20,
  command := $$
    SELECT net.http_post(
      url := 'https://iqzkayoqqagowvxeaphe.supabase.co/functions/v1/embed-episode-runner',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxemtheW9xcWFnb3d2eGVhcGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDA3NzAsImV4cCI6MjA5MzU3Njc3MH0.KaeRcYcljGjrP_OAcTp_lapPSRsAYRq6gPJ2vYV7fz4"}'::jsonb,
      body := concat('{"trigger":"cron","ts":"', now(), '"}')::jsonb,
      timeout_milliseconds := 115000
    );
  $$
);

SELECT cron.alter_job(
  job_id := 12,
  command := $$
    select net.http_post(
      url:='https://iqzkayoqqagowvxeaphe.supabase.co/functions/v1/seo-enrich-runner',
      headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxemtheW9xcWFnb3d2eGVhcGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDA3NzAsImV4cCI6MjA5MzU3Njc3MH0.KaeRcYcljGjrP_OAcTp_lapPSRsAYRq6gPJ2vYV7fz4","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxemtheW9xcWFnb3d2eGVhcGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDA3NzAsImV4cCI6MjA5MzU3Njc3MH0.KaeRcYcljGjrP_OAcTp_lapPSRsAYRq6gPJ2vYV7fz4"}'::jsonb,
      body:='{"trigger":"cron","batch":20}'::jsonb,
      timeout_milliseconds := 115000
    );
  $$
);

SELECT cron.alter_job(
  job_id := 18,
  command := $$
    select net.http_post(
      url:='https://iqzkayoqqagowvxeaphe.supabase.co/functions/v1/embed-podcast-runner',
      headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxemtheW9xcWFnb3d2eGVhcGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDA3NzAsImV4cCI6MjA5MzU3Njc3MH0.KaeRcYcljGjrP_OAcTp_lapPSRsAYRq6gPJ2vYV7fz4"}'::jsonb,
      body:='{"batch":25}'::jsonb,
      timeout_milliseconds := 115000
    );
  $$
);
