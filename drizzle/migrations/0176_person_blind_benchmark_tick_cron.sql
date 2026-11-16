-- lovable-cron-fallback-reviewed: 9 already-paid provider batches (497 episodes) are still waiting to be read back and the owner-enabled blind benchmark needs the same provider polling; OpenAI batch completion has no callback, so a 10-minute check (144/day, same cadence this worker already had in production) is the least frequent schedule that drains already-paid work without delaying it.
-- The blind benchmark shadow job (10 episodes, owner-enabled, 0.10 USD cap) runs inside
-- the existing authenticated person-relevance-openai-batch worker. Its scheduler row was
-- removed together with the pilot pause, so nothing called the tick and the seeded job
-- would sit forever. This restores ONLY the caller.
--
-- Nothing is re-enabled here: the person-relevance batch lane stays disabled by
-- person_relevance_openai_batch_controls.enabled=false, and the paid episode pilot stays
-- blocked by episode_enrichment_pilot_controls.submit_paused_reason. Both are re-checked
-- inside the worker on every tick, so this cron cannot resume paid work on its own.
SELECT COALESCE(cron.unschedule(jobid), true)
  FROM cron.job WHERE jobname = 'person-relevance-openai-batch-tick';

SELECT cron.schedule(
  'person-relevance-openai-batch-tick',
  '*/10 * * * *',
  $cmd$
DO $b$
DECLARE tok text := (SELECT token FROM public.internal_job_tokens WHERE job = 'scheduler');
BEGIN
  IF tok IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/person-relevance-openai-batch',
    headers := jsonb_build_object('x-internal-token', tok, 'Content-Type', 'application/json'),
    body := '{"action":"tick","trigger":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
END $b$;
  $cmd$
);
