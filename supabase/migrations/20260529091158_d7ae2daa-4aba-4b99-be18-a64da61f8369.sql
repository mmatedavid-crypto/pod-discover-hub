-- NO-OP SAFETY MIGRATION.
--
-- This migration used to truncate public.episode_clean_text and reset all
-- episode clean-text statuses. That is unsafe for a live site: old clean text
-- must remain available until a new candidate has been generated, audited, and
-- promoted.
--
-- Keep this file as a no-op so an already-referenced migration version cannot
-- accidentally destroy production data.
SELECT 1;
