UPDATE public.podcasts
SET is_hungarian = false,
    language_decision = 'reject_non_hungarian'
WHERE is_hungarian = true
  AND language IS NOT NULL
  AND language NOT ILIKE 'hu%';

REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_feed;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_evergreen;