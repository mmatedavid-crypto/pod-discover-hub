-- Re-enqueue 152 HU episodes that got English AI summaries (detected_language was NULL → language guard skipped)
UPDATE episodes e
SET detected_language = 'hu',
    ai_summary = NULL,
    ai_enriched_at = NULL
FROM podcasts p
WHERE p.id = e.podcast_id
  AND p.language ILIKE 'hu%'
  AND e.ai_summary IS NOT NULL
  AND e.ai_summary !~ '[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]'
  AND length(e.ai_summary) > 80;