ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS entity_extraction_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.episode_organization_map
  ADD COLUMN IF NOT EXISTS source_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_episodes_entity_evidence_gin
  ON public.episodes USING gin (entity_extraction_evidence);

UPDATE public.app_settings
SET value = value
  || jsonb_build_object(
    'entity_schema_version', 5,
    'strict_evidence_required', true,
    'note', 'Entity extraction v5 requires literal evidence for people/orgs before public/indexable mapping. Keeps legacy arrays for compatibility.'
  ),
  updated_at = now()
WHERE key = 'entity_backfill_controls';
