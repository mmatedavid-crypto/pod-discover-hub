
ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS hosts text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hosts_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS hosts_source text;

ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS mentioned text[] NOT NULL DEFAULT '{}';

-- Helpful index for entity_profile_runner aggregation
CREATE INDEX IF NOT EXISTS idx_episodes_people_gin ON public.episodes USING GIN (people);
CREATE INDEX IF NOT EXISTS idx_episodes_mentioned_gin ON public.episodes USING GIN (mentioned);
