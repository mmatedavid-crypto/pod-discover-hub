UPDATE people
SET ai_bio_status = 'pending'
WHERE ai_bio_status IN ('completed', 'needs_review', 'audited_fail', 'insufficient_evidence');