-- Company eponyms are organization aliases in this catalog, not podcast
-- people, unless editors explicitly approve a historical/archival person page.
-- Example: "Richter Gedeon" should land on the company page by default.

WITH marked AS (
  SELECT public.normalize_entity_alias(alias) AS normalized_alias
  FROM (VALUES
    ('Richter Gedeon'),
    ('Gedeon Richter')
  ) AS v(alias)
)
UPDATE public.canonical_entity_aliases cea
SET notes = trim(both E'\n' from concat_ws(E'\n', cea.notes, 'eponym_person_name')),
    updated_at = now()
FROM marked m
WHERE cea.entity_kind = 'organization'
  AND cea.canonical_slug = 'richter-gedeon-nyrt'
  AND cea.normalized_alias = m.normalized_alias
  AND COALESCE(cea.notes, '') NOT ILIKE '%eponym_person_name%';

WITH eponym_aliases AS (
  SELECT DISTINCT normalized_alias
  FROM public.canonical_entity_aliases
  WHERE entity_kind = 'organization'
    AND status = 'active'
    AND COALESCE(notes, '') ILIKE '%eponym_person_name%'
)
UPDATE public.people p
SET is_public = false,
    is_indexable = false,
    activation_status = 'inactive',
    ai_recommended_action = 'reject',
    ai_review_status = 'reviewed',
    is_historical = true,
    is_deceased = true,
    editorial_notes = trim(both E'\n' from concat_ws(E'\n', p.editorial_notes, 'hidden_as_company_eponym_without_podcast_person_evidence')),
    updated_at = now()
WHERE COALESCE(p.has_archival_evidence, false) = false
  AND COALESCE(p.manual_approved, false) = false
  AND EXISTS (
    SELECT 1
    FROM eponym_aliases ea
    WHERE ea.normalized_alias = p.normalized_name
       OR ea.normalized_alias = public.normalize_entity_alias(p.name)
  );

WITH eponym_people AS (
  SELECT p.id
  FROM public.people p
  JOIN public.canonical_entity_aliases cea
    ON cea.entity_kind = 'organization'
   AND cea.status = 'active'
   AND COALESCE(cea.notes, '') ILIKE '%eponym_person_name%'
   AND (
      cea.normalized_alias = p.normalized_name
      OR cea.normalized_alias = public.normalize_entity_alias(p.name)
   )
  WHERE COALESCE(p.has_archival_evidence, false) = false
    AND COALESCE(p.manual_approved, false) = false
)
UPDATE public.person_aliases pa
SET status = 'rejected',
    source = 'hidden_as_company_eponym_without_podcast_person_evidence'
FROM eponym_people ep
WHERE pa.person_id = ep.id;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'company_eponym_person_policy',
  jsonb_build_object(
    'version', 1,
    'rule', 'organization_alias_with_eponym_person_name_note_is_not_public_person_without_manual_or_archival_evidence',
    'example', 'Richter Gedeon -> Richter Gedeon Nyrt.',
    'updated_at', now()
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
