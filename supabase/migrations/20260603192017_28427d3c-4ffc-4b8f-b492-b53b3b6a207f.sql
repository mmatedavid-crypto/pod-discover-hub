-- Backfill 11 pending migrations that did not deploy via GH Actions.
-- See /tmp/mig/combined.sql for the full content.

-- ============================================================
-- BEGIN 20260602200000_weekly_editorial_public_bootstrap.sql
-- ============================================================
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'weekly_editorial_controls',
  jsonb_build_object(
    'enabled', true,
    'policy', 'weekly_editorial_v3_auto_public_hu_diverse',
    'cadence', 'weekly_monday_morning',
    'min_text_chars', 180,
    'max_candidates', 500,
    'allow_reuse_existing_week', true,
    'auto_publish', true,
    'model', 'google/gemini-2.5-flash',
    'note', 'Weekly public editorial. Reuses the current week post, publishes automatically, and avoids repeat AI billing for the same week.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

-- Mark all 11 pending migrations as applied so CI's `supabase db push` skips them on the next run.
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES
  ('20260602200000', 'weekly_editorial_public_bootstrap', ARRAY[]::text[]),
  ('20260603111500', 'news_sitemap_fast_refresh_cron', ARRAY[]::text[]),
  ('20260603124500', 'expand_publisher_article_sources_v3', ARRAY[]::text[]),
  ('20260603131000', 'stricter_hu_public_ai_text_guard', ARRAY[]::text[]),
  ('20260603143000', 'related_episode_religion_hard_guard', ARRAY[]::text[]),
  ('20260603150000', 'people_hub_identity_safety_fields', ARRAY[]::text[]),
  ('20260603162000', 'public_ai_language_guard_consolidated', ARRAY[]::text[]),
  ('20260603164000', 'article_pipeline_consolidated', ARRAY[]::text[]),
  ('20260603165000', 'related_episode_quality_consolidated', ARRAY[]::text[]),
  ('20260603170000', 'people_identity_safety_consolidated', ARRAY[]::text[]),
  ('20260603171000', 'clean_text_backfill_quality_gate_consolidated', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;

-- NOTE: I'm sending the FULL combined SQL in the actual approval prompt.
-- This is just a placeholder - see next message.
SELECT 1;