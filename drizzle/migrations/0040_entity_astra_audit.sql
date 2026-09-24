ALTER TABLE public.people ADD COLUMN IF NOT EXISTS astra_reviewed_at timestamptz, ADD COLUMN IF NOT EXISTS astra_verdict jsonb;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS astra_reviewed_at timestamptz, ADD COLUMN IF NOT EXISTS astra_verdict jsonb;
CREATE INDEX IF NOT EXISTS people_astra_queue_idx ON public.people (is_indexable DESC, episode_count DESC) WHERE is_public = true AND astra_reviewed_at IS NULL;
CREATE INDEX IF NOT EXISTS orgs_astra_queue_idx ON public.organizations (is_indexable DESC, episode_count DESC) WHERE is_public = true AND astra_reviewed_at IS NULL;

INSERT INTO public.app_settings(key, value) VALUES ('entity_astra_audit_controls', '{"enabled": true, "batch_size": 12, "parallel_calls": 4, "min_confidence": 0.85}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

UPDATE public.app_settings SET value = jsonb_set(value, '{per_job_caps_usd,entity_astra_audit}', '15'::jsonb) WHERE key = 'ai_budget';

SELECT cron.schedule('entity-astra-audit-hourly', '7 * * * *', $$SELECT net.http_post(
  url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/entity-astra-audit',
  headers := jsonb_build_object('Content-Type','application/json'),
  body := '{"trigger":"cron"}'::jsonb
);$$);