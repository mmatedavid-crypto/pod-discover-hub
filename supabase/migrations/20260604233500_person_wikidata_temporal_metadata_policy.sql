INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'person_wikidata_temporal_metadata_policy',
  jsonb_build_object(
    'version', 1,
    'source', 'Wikidata claims on verified person matches',
    'date_of_birth_claim', 'P569',
    'date_of_death_claim', 'P570',
    'human_claim', 'P31=Q5',
    'runner', 'person-wikimedia-enricher',
    'behavior', 'Verified Wikidata matches with missing is_living/date_of_death are prioritized before generic unchecked rows. P570 marks the row deceased/historical so public guards can hide non-archival historical people.',
    'cost', 'No AI call; Wikimedia/Wikidata HTTP only.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
