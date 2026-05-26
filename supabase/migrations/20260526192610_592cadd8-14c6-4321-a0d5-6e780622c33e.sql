
WITH bad AS (
  SELECT e.id
  FROM episodes e
  JOIN podcasts p ON p.id = e.podcast_id
  WHERE p.language ILIKE 'hu%'
    AND e.ai_summary IS NOT NULL
    AND length(e.ai_summary) >= 40
    AND ((SELECT count(*) FROM regexp_matches(lower(e.ai_summary),
           '\m(the|and|of|to|in|is|for|on|with|that|this|are|was|were|by|from|as|at|an|be|or|it|its|they|you|we|our|your|has|have|had|but|not|which|also|more|than|these|those|about|when|what|who|how|why)\M', 'g'))::float
         / GREATEST(array_length(regexp_split_to_array(e.ai_summary, '\s+'), 1), 1)) > 0.12
)
UPDATE episodes
SET ai_summary = NULL,
    seo_title = NULL,
    seo_description = NULL,
    ai_enriched_at = NULL,
    ai_summary_source = NULL
WHERE id IN (SELECT id FROM bad);
