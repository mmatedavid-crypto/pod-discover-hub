CREATE TABLE IF NOT EXISTS public.person_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  question text NOT NULL,
  answer text NOT NULL,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, position)
);

CREATE INDEX IF NOT EXISTS person_faqs_person_idx ON public.person_faqs (person_id, position);

GRANT SELECT ON public.person_faqs TO anon;
GRANT SELECT ON public.person_faqs TO authenticated;
GRANT ALL ON public.person_faqs TO service_role;

ALTER TABLE public.person_faqs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Person FAQs are publicly readable" ON public.person_faqs;
CREATE POLICY "Person FAQs are publicly readable"
ON public.person_faqs FOR SELECT
TO anon, authenticated
USING (true);

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS page_summary_hu text,
  ADD COLUMN IF NOT EXISTS page_summary_generated_at timestamptz;