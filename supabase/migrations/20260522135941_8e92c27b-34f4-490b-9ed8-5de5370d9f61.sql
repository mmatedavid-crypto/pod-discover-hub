-- HU-only strict enforcement: deactivate any podcast whose language is not Hungarian.
-- The site is HU-only (per project policy), so non-HU podcasts must not appear in any
-- public surface, ticker, search index, or background pipeline.
UPDATE public.podcasts
SET rss_status = 'inactive',
    rank_label = NULL,
    is_hungarian = false,
    updated_at = now()
WHERE (language IS NULL OR language NOT ILIKE 'hu%')
  AND (rss_status IS DISTINCT FROM 'inactive' OR rank_label IS NOT NULL OR is_hungarian = true);