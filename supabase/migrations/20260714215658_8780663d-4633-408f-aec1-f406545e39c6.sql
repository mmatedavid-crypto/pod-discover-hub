
ALTER TABLE public.episodes ADD COLUMN IF NOT EXISTS is_prefetch_placeholder boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_episodes_prefetch_placeholder ON public.episodes (podcast_id) WHERE is_prefetch_placeholder = true;

SELECT cron.schedule(
  'bible-prefetch-nightly',
  '0 18 * * *',
  $$
  select net.http_post(
    url:='https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/bible-prefetch',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
  $$
);
