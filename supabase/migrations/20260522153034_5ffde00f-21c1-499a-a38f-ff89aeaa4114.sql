UPDATE public.people
SET is_public = false,
    activation_status = 'inactive'
WHERE is_public = true
  AND ai_bio ILIKE '%magyar podcast epizódokban előforduló személy%';

UPDATE public.people
SET ai_bio_status = 'pending',
    ai_bio = NULL
WHERE wikipedia_match_status = 'verified'
  AND is_public = true
  AND (ai_bio_model = 'wikipedia_verified' OR ai_bio_model IS NULL OR ai_bio_model NOT LIKE 'openai/gpt-5%');

SELECT public.recompute_person_gated_counts();