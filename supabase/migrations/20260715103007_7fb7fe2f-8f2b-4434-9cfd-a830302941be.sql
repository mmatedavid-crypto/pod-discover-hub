CREATE TABLE IF NOT EXISTS public.bible_reading_plan (
  day smallint PRIMARY KEY CHECK (day BETWEEN 1 AND 365),
  readings text[] NOT NULL,
  readings_display text NOT NULL,
  period_hu text NOT NULL,
  period_en text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bible_reading_plan TO anon, authenticated;
GRANT ALL ON public.bible_reading_plan TO service_role;

ALTER TABLE public.bible_reading_plan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bible_reading_plan public read"
  ON public.bible_reading_plan FOR SELECT
  TO anon, authenticated
  USING (true);