
-- Phase 2: Typed organizations extraction
-- Add jsonb column for typed entity output (kept alongside legacy `companies` flat array)
ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS organizations jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.episodes.organizations IS
  'Typed organization extraction from entity-backfill-runner v3: array of {name, type} where type in (company|party|institution|media|ngo|sport_team|sport_league|church|university|research|radio_station|other). Legacy `companies` flat array stays populated for backwards compat.';

CREATE INDEX IF NOT EXISTS idx_episodes_organizations_gin
  ON public.episodes USING gin (organizations);

-- Bump ai_entities_version target: re-run all v2 episodes through the new typed extractor
-- (entity-backfill-runner code change updates `lt(ai_entities_version, 3)`)

-- Update controls: switch to gemini-2.5-flash for higher-quality typed extraction
UPDATE public.app_settings
SET value = jsonb_build_object(
      'model', 'google/gemini-2.5-flash',
      'enabled', true,
      'updated_at', now()::text,
      'daily_budget_usd', 25,
      'model_policy_note', '2026-05-21: bumped to gemini-2.5-flash for typed org extraction (parties/sport/church/etc). Revert to lite after v3 drain.'
    ),
    updated_at = now()
WHERE key = 'entity_backfill_controls';
