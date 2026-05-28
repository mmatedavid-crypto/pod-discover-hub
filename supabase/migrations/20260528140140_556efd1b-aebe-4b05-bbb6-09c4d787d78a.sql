
CREATE TABLE IF NOT EXISTS public.episode_extracted_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  raw_label text NOT NULL,
  normalized_label text NOT NULL,
  kind text,
  confidence numeric(3,2),
  rationale text,
  model text NOT NULL,
  extractor_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eet_episode ON public.episode_extracted_topics(episode_id);
CREATE INDEX IF NOT EXISTS idx_eet_norm ON public.episode_extracted_topics(normalized_label);

ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS topic_extraction_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS topic_extraction_version int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS topic_extracted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_episodes_topic_extraction
  ON public.episodes(topic_extraction_status, podcast_id)
  WHERE topic_extraction_status = 'pending';

GRANT SELECT ON public.episode_extracted_topics TO authenticated;
GRANT ALL ON public.episode_extracted_topics TO service_role;

ALTER TABLE public.episode_extracted_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "extracted_topics_admin_read" ON public.episode_extracted_topics
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.app_settings(key, value)
VALUES ('episode_topic_extractor_controls', jsonb_build_object(
  'enabled', true,
  'model', 'google/gemini-2.5-flash-lite',
  'daily_budget_usd', 10,
  'batch_limit', 30,
  'tier_filter', ARRAY['S'],
  'min_clean_chars', 400,
  'extractor_version', 1
))
ON CONFLICT (key) DO NOTHING;
