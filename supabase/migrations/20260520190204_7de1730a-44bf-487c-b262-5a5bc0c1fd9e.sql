
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS wiki_match_reason text,
  ADD COLUMN IF NOT EXISTS short_description_hu text,
  ADD COLUMN IF NOT EXISTS occupation_labels text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS date_of_death date,
  ADD COLUMN IF NOT EXISTS is_living boolean,
  ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS wiki_match_run_at timestamptz;

ALTER TABLE public.people
  DROP CONSTRAINT IF EXISTS people_entity_type_chk;
ALTER TABLE public.people
  ADD CONSTRAINT people_entity_type_chk CHECK (entity_type IN (
    'unknown','living_person','historical_person','foreign_public_figure',
    'mentioned_public_figure','podcast_participant'
  ));

CREATE INDEX IF NOT EXISTS idx_people_entity_type ON public.people(entity_type) WHERE entity_type <> 'unknown';
CREATE INDEX IF NOT EXISTS idx_people_wiki_match_run_at ON public.people(wiki_match_run_at);
