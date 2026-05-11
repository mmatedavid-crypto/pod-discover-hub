
-- Track AI categorization metadata on podcasts
ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS ai_category_confidence numeric,
  ADD COLUMN IF NOT EXISTS ai_category_alt text,
  ADD COLUMN IF NOT EXISTS ai_category_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_category_model text,
  ADD COLUMN IF NOT EXISTS ai_category_needs_review boolean DEFAULT false;

-- Index to quickly find uncategorized active EN podcasts by tier priority
CREATE INDEX IF NOT EXISTS idx_podcasts_uncategorized_tier
  ON public.podcasts (shadow_rank_tier, podiverzum_rank DESC NULLS LAST)
  WHERE category IS NULL;

-- Index to find low-confidence rows for admin review
CREATE INDEX IF NOT EXISTS idx_podcasts_ai_cat_review
  ON public.podcasts (ai_category_confidence)
  WHERE ai_category_needs_review = true;

-- Seed default controls for the categorize runner
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'ai_categorize_controls',
  jsonb_build_object(
    'enabled', true,
    'daily_budget_usd', 5,
    'batch', 30,
    'concurrency', 6,
    'model', 'google/gemini-2.5-flash',
    'low_confidence_threshold', 0.75,
    'max_attempts', 3
  ),
  now()
)
ON CONFLICT (key) DO NOTHING;

-- Adaptive cron RPC for the new runner (allowlisted schedules only)
CREATE OR REPLACE FUNCTION public.set_categorize_runner_schedule(_schedule text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  allowed text[] := ARRAY['* * * * *','*/2 * * * *','*/5 * * * *','*/10 * * * *','*/30 * * * *','0 * * * *'];
  job_name text := 'podiverzum-ai-categorize-adaptive';
  current_sched text;
BEGIN
  IF NOT (_schedule = ANY(allowed)) THEN
    RAISE EXCEPTION 'schedule % not in allowlist', _schedule;
  END IF;
  SELECT schedule INTO current_sched FROM cron.job WHERE jobname = job_name;
  IF current_sched IS NULL THEN
    RETURN 'job_not_found';
  END IF;
  IF current_sched = _schedule THEN
    RETURN 'unchanged';
  END IF;
  PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = job_name), schedule := _schedule);
  RETURN _schedule;
END;
$$;
