UPDATE pi_feed_staging
SET newest_item_at = now()
WHERE import_id IN (SELECT id FROM pi_dump_imports WHERE source='apple_rss_charts')
  AND newest_item_at IS NULL
  AND processed = false;