-- Wipe English ai_summary/seo fields on Hungarian podcasts so the seo-enrich
-- enqueuer (which targets ai_summary IS NULL) regenerates them in Hungarian.
-- The seo-enrich-runner now has a HU language guard with retry to prevent
-- regression.

WITH bad AS (
  SELECT e.id
  FROM episodes e
  JOIN podcasts p ON p.id = e.podcast_id
  WHERE p.language ILIKE 'hu%'
    AND e.ai_summary IS NOT NULL
    AND length(e.ai_summary) > 60
    AND e.ai_summary !~ '[őűáéíóúöüÖÜÓŐÚÉÁŰÍ]'
    AND lower(e.ai_summary) ~ '\m(the|and|of|with|about|discusses|shares|episode|conversation|interview)\M'
)
UPDATE episodes
SET ai_summary = NULL,
    seo_title = NULL,
    seo_description = NULL,
    ai_enriched_at = NULL
WHERE id IN (SELECT id FROM bad);