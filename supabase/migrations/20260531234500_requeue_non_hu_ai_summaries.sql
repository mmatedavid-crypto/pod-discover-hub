-- Podiverzum is a Hungarian site: public episode AI summaries must be Hungarian.
-- Remove existing English-looking ai_summary values from accepted Hungarian podcasts so
-- seo-enrich-enqueue can regenerate them through the new HU-only guard.

UPDATE public.episodes e
SET
  ai_summary = NULL,
  ai_summary_source = NULL,
  ai_enriched_at = NULL
FROM public.podcasts p
WHERE p.id = e.podcast_id
  AND p.is_hungarian = TRUE
  AND p.language_decision = 'accept_hungarian'
  AND e.ai_summary IS NOT NULL
  AND length(trim(e.ai_summary)) > 80
  AND e.ai_summary !~ '[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]'
  AND e.ai_summary ~* '\m(the|and|of|to|in|with|this|that|episode|podcast|discusses|explores|features|conversation|interview|about)\M';

