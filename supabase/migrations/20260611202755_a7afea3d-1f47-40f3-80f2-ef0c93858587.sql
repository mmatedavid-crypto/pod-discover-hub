SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='indexnow-submit-daily';

SELECT cron.schedule(
  'indexnow-submit-daily',
  '15 5 * * *',
  $$SELECT net.http_post(
    url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/indexnow-submit?mode=recent&hours=26&max=3000',
    headers := jsonb_build_object('Content-Type','application/json')
  );$$
);