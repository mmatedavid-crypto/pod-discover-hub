-- Pogány Induló (Szirmai Marcell) javítás: 17 gated epizód, mégis rejtett volt.
UPDATE public.people
SET is_public = true,
    is_indexable = true,
    is_browsable_in_people_hub = true,
    activation_status = 'indexable',
    persona = CASE WHEN persona = 'mixed' THEN 'participant' ELSE persona END,
    updated_at = now()
WHERE id = 'ae37b8be-957f-49c3-a91e-e2ebf56316bd';

-- Hozzáadjuk a 'Szirmai Marcell' (két l) aliast — eddig csak 'Szirmai Marcel' volt.
INSERT INTO public.person_aliases (person_id, alias, normalized_alias, confidence, source, status, scope, reviewed_at)
VALUES (
  'ae37b8be-957f-49c3-a91e-e2ebf56316bd',
  'Szirmai Marcell',
  'szirmai marcell',
  0.95,
  'editorial_seed',
  'accepted',
  'global',
  now()
)
ON CONFLICT DO NOTHING;