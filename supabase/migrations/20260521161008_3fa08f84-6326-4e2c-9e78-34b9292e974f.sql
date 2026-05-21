
UPDATE public.app_settings
SET value = jsonb_set(
              jsonb_set(value, '{daily_cap_usd}', '80'::jsonb, true),
              '{per_job_caps_usd,entity_backfill}', '25'::jsonb, true
            ) || jsonb_build_object('updated_at', to_jsonb(now()::text), 'updated_note', 'Sprint bump 2026-05-21: entity backfill drain'),
    updated_at = now()
WHERE key = 'ai_budget';
