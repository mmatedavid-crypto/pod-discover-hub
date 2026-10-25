-- lovable-cron-fallback-reviewed: temporary drain of a bounded 302-row review list; waits for short gaps between visitor-facing work, removes itself after drain or by 2026-10-27
INSERT INTO public.internal_job_tokens (job) VALUES ('clean-text-astra-review') ON CONFLICT (job) DO NOTHING;

SELECT cron.schedule('clean-text-astra-review-temp', '*/3 * * * *', $cmd$
SELECT cron.unschedule('clean-text-astra-review-temp')
WHERE now() > timestamptz '2026-10-27 00:00:00+00'
   OR NOT EXISTS (
     SELECT 1 FROM public.clean_text_repair_queue q
     WHERE q.status IN ('needs_review','quarantine')
       AND NOT EXISTS (SELECT 1 FROM public.clean_text_astra_reviews r
                       WHERE r.episode_id = q.episode_id AND r.prompt_version = 'clean-text-astra-review-v1' AND r.status = 'completed'));
SELECT net.http_post(
  url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/clean-text-repair-queue',
  headers := jsonb_build_object('Content-Type','application/json','x-internal-token',(SELECT token FROM public.internal_job_tokens WHERE job = 'clean-text-astra-review')),
  body := '{"action":"astra_review","confirm":"ASTRA_REVIEW_ADVISORY","trigger":"cron"}'::jsonb,
  timeout_milliseconds := 150000
)
WHERE now() <= timestamptz '2026-10-27 00:00:00+00'
  AND EXISTS (
     SELECT 1 FROM public.clean_text_repair_queue q
     WHERE q.status IN ('needs_review','quarantine')
       AND NOT EXISTS (SELECT 1 FROM public.clean_text_astra_reviews r
                       WHERE r.episode_id = q.episode_id AND r.prompt_version = 'clean-text-astra-review-v1' AND r.status = 'completed'));
$cmd$);