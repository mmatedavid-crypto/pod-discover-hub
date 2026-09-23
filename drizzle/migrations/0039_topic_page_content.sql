ALTER TABLE public.topics
  ADD COLUMN IF NOT EXISTS intro_long_hu text,
  ADD COLUMN IF NOT EXISTS faqs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS content_generated_at timestamptz;