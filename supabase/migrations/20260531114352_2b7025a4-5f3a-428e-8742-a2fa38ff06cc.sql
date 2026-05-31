UPDATE episodes e
SET clean_text_status='pending'
FROM episode_youtube_links y
WHERE y.episode_id=e.id
  AND y.status='confirmed'
  AND y.youtube_description IS NOT NULL
  AND e.clean_text_status='done'
  AND length(y.youtube_description) > length(coalesce(e.description, e.summary, ''));