UPDATE app_settings SET value = jsonb_set(jsonb_set(value, '{batch}', '120'::jsonb), '{concurrency}', '24'::jsonb) WHERE key IN ('seo_enrich_controls','ai_enrichment_controls');

UPDATE app_settings SET value = jsonb_set(jsonb_set(value, '{batch}', '120'::jsonb), '{concurrency}', '16'::jsonb) WHERE key = 'ai_categorize_controls';

UPDATE app_settings SET value = jsonb_set(jsonb_set(jsonb_set(value, '{batch}', '150'::jsonb), '{concurrency}', '12'::jsonb), '{daily_budget_usd}', '8'::jsonb) WHERE key = 'embed_episode_controls';

UPDATE app_settings SET value = jsonb_set(jsonb_set(jsonb_set(value, '{batch}', '100'::jsonb), '{concurrency}', '8'::jsonb), '{daily_budget_usd}', '5'::jsonb) WHERE key = 'embed_controls';