-- A previously verified-looking Wikipedia snippet can remain in short_bio even
-- after the wiki matcher later downgrades the candidate to no_match. Public
-- person pages must not publish stale biographical claims from rejected wiki
-- candidates.
UPDATE public.people
SET
  short_bio = NULL,
  updated_at = now()
WHERE wikipedia_match_status IS DISTINCT FROM 'verified'
  AND short_bio IS NOT NULL
  AND wikipedia_description IS NOT NULL
  AND lower(short_bio) LIKE '%' || lower(wikipedia_description) || '%';

-- Known collision: the podcast evidence points to finance/business contexts,
-- while the rejected Wikipedia candidate is the film director.
UPDATE public.people
SET
  short_bio = NULL,
  disambiguation_label = COALESCE(disambiguation_label, 'pénzügyi és üzleti témákban szereplő Szabó László'),
  disambiguation_context = COALESCE(disambiguation_context, 'finance_business'),
  updated_at = now()
WHERE slug = 'szabo-laszlo'
  AND wikipedia_match_status IS DISTINCT FROM 'verified'
  AND (
    short_bio ILIKE '%filmrendező%'
    OR wikipedia_title ILIKE '%filmrendező%'
    OR wikipedia_description ILIKE '%filmrendező%'
  );
