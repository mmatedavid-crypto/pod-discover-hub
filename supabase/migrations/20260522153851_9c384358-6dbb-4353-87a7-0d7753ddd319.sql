UPDATE public.people SET is_public=false, activation_status='inactive'
WHERE is_public=true AND ai_bio ILIKE '%magyar podcast epizódokban előforduló személy%';
SELECT public.recompute_person_gated_counts();