-- Defensive cleanup for public homepage mood-card copy.
-- These labels are user-facing; never expose broken one-word placeholders.

UPDATE public.mood_collections
SET
  title = CASE lower(title)
    WHEN 'test' THEN 'Mozgás és egészség'
    WHEN 'fej' THEN 'Gondolatok és tudás'
    WHEN 'élet' THEN 'Lélek és élethelyzetek'
    WHEN 'elet' THEN 'Lélek és élethelyzetek'
    ELSE title
  END,
  short_description = CASE
    WHEN lower(title) IN ('test', 'fej', 'élet', 'elet') AND (short_description IS NULL OR length(trim(short_description)) < 12)
      THEN 'Válogatott magyar podcast epizódok ehhez a hallgatási helyzethez.'
    ELSE short_description
  END,
  description = CASE
    WHEN lower(title) IN ('test', 'fej', 'élet', 'elet') AND (description IS NULL OR length(trim(description)) < 12)
      THEN 'Válogatott magyar podcast epizódok ehhez a hallgatási helyzethez.'
    ELSE description
  END
WHERE lower(title) IN ('test', 'fej', 'élet', 'elet');

