
SELECT cron.schedule(
  'podiverzum-person-relevance-judge',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/person-relevance-judge',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('batch_limit', 40)
  );
  $$
);
