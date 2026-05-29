
UPDATE public.people
SET ai_bio_status = 'pending'
WHERE ai_bio_status = 'needs_review'
  AND (ai_bio_sources->>'audit') IS NULL;
