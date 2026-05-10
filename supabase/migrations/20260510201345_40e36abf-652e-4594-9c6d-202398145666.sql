DELETE FROM pi_feed_staging
WHERE import_id IN (SELECT id FROM pi_dump_imports WHERE source='apple_rss_charts');