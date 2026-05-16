
WITH agg AS (
  SELECT p.id,
         count(*) FILTER (WHERE e.ai_summary IS NOT NULL) AS n_sum,
         count(*) FILTER (WHERE e.ai_summary IS NOT NULL AND e.ai_summary ~ '[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]') AS n_hu
  FROM podcasts p
  JOIN episodes e ON e.podcast_id = p.id
  WHERE p.language ILIKE 'hu%'
  GROUP BY p.id
),
fix AS (
  SELECT id FROM agg WHERE n_sum >= 3 AND n_hu = 0
)
UPDATE podcasts SET language = 'en', updated_at = now()
WHERE id IN (SELECT id FROM fix);

SELECT refresh_homepage_feed();
