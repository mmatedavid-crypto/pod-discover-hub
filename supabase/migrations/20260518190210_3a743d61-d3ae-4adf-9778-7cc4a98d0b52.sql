
-- 1) Canonicalize bare "Zsiday" surname tokens to "Zsiday Viktor" in episodes.people
--    Safe globally: DB has exactly one Zsiday person (distinctive surname).
UPDATE episodes
SET people = (
  SELECT ARRAY(
    SELECT DISTINCT CASE WHEN p = 'Zsiday' THEN 'Zsiday Viktor' ELSE p END
    FROM unnest(people) AS p
  )
)
WHERE 'Zsiday' = ANY(people);

-- 2) Same for mentioned[] (defensive)
UPDATE episodes
SET mentioned = (
  SELECT ARRAY(
    SELECT DISTINCT CASE WHEN p = 'Zsiday' THEN 'Zsiday Viktor' ELSE p END
    FROM unnest(mentioned) AS p
  )
)
WHERE 'Zsiday' = ANY(mentioned);

-- 3) Ensure the alias row exists (idempotent — already exists per audit)
INSERT INTO person_aliases (person_id, alias, normalized_alias, source, confidence)
SELECT '288b444d-9bfd-45b6-a16b-4f4b73589cac', 'Zsiday', 'zsiday', 'manual', 0.95
WHERE NOT EXISTS (
  SELECT 1 FROM person_aliases
  WHERE person_id='288b444d-9bfd-45b6-a16b-4f4b73589cac' AND normalized_alias='zsiday'
);

-- 4) Refresh gated counts for affected person
SELECT public.recompute_person_gated_counts();
