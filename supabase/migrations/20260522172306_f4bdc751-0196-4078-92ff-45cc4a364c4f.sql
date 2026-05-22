-- One-off cleanup: remove duplicated canonical-name prefix from ai_bio
-- where the wiki extract already started with the full name (causing
-- "{name} {firstname-lower}{rest}" pattern). Only touches confirmed dups.
UPDATE public.people p
SET ai_bio = (
  -- strip the leading "{name} " then capitalize first char
  upper(substring(regexp_replace(ai_bio, '^' || regexp_replace(name, '([\.\+\*\?\(\)\[\]\\])', '\\\1', 'g') || ' ', '') from 1 for 1))
  || substring(regexp_replace(ai_bio, '^' || regexp_replace(name, '([\.\+\*\?\(\)\[\]\\])', '\\\1', 'g') || ' ', '') from 2)
)
WHERE ai_bio IS NOT NULL
  AND ai_bio NOT ILIKE '%magyar podcast epizódokban előforduló személy%'
  AND ai_bio ~* (regexp_replace(name, '([\.\+\*\?\(\)\[\]\\])', '\\\1', 'g') || '\s+' || regexp_replace(split_part(name,' ',1), '([\.\+\*\?\(\)\[\]\\])', '\\\1', 'g'));