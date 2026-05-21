-- Enable embed-episode-chunks runner for drain phase on external Gemini API
-- 1) Bump budget + flip enabled=true
UPDATE app_settings
SET value = jsonb_set(
              jsonb_set(
                jsonb_set(value::jsonb, '{enabled}', 'true'::jsonb),
                '{daily_budget_usd}', '20'::jsonb
              ),
              '{note}', '"2026-05-21: drain via external Gemini API (GEMINI_API_KEY). Budget bumped to $20/day until pending=0; runner auto-throttles to */30 + flips chunk_aug check afterwards."'::jsonb
            ),
    updated_at = now()
WHERE key = 'embed_episode_chunks_controls';

-- 2) Activate + minutely schedule cron job 26 during drain
DO $$
DECLARE
  job_record record;
BEGIN
  FOR job_record IN
    SELECT jobid, jobname FROM cron.job
    WHERE jobname IN ('podiverzum-embed-episode-chunks', 'podiverzum-embed-episode-chunks-runner')
  LOOP
    PERFORM cron.alter_job(job_record.jobid, schedule => '* * * * *', active => true);
  END LOOP;
END $$;