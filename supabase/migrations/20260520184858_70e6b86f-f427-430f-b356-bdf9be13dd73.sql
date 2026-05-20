
-- 1. Temporal status flags on people
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS is_deceased boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_historical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_archival_evidence boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_people_temporal
  ON public.people (is_deceased, is_historical)
  WHERE is_deceased OR is_historical;

-- 2. Recompute has_archival_evidence from existing mentions (will be 0 until classifier writes them)
CREATE OR REPLACE FUNCTION public.recompute_person_archival_evidence()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE updated_count integer;
BEGIN
  WITH agg AS (
    SELECT person_id, bool_or(mention_type = 'archival_source') AS has_arch
    FROM public.person_episode_mentions
    GROUP BY person_id
  )
  UPDATE public.people p
  SET has_archival_evidence = COALESCE(a.has_arch, false)
  FROM agg a
  WHERE a.person_id = p.id
    AND p.has_archival_evidence IS DISTINCT FROM COALESCE(a.has_arch, false);
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

SELECT public.recompute_person_archival_evidence();

-- 3. Seed obvious historical / deceased figures (case-insensitive name match)
UPDATE public.people
SET is_deceased = true, is_historical = true
WHERE lower(name) = ANY (ARRAY[
  'kádár jános','radnóti miklós','ady endre','józsef attila',
  'winston churchill','churchill','ronald reagan','reagan',
  'petőfi sándor','arany jános','jókai mór','móricz zsigmond',
  'kosztolányi dezső','babits mihály','karinthy frigyes',
  'szent istván','mátyás király','i. mátyás','hunyadi jános',
  'kossuth lajos','széchenyi istván','deák ferenc','horthy miklós',
  'nagy imre','rákosi mátyás','antall józsef'
]);
