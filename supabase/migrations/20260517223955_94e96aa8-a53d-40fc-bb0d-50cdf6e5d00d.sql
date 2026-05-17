CREATE OR REPLACE VIEW public.v_hu_archive_completeness AS
SELECT
  p.id AS podcast_id,
  p.title,
  p.slug,
  p.rank_label,
  p.podiverzum_rank,
  p.rss_url,
  p.rss_status,
  p.last_fetched_at,
  p.hydrated_episode_count,
  p.full_backfill_completed_at,
  p.pi_backfill_completed_at,
  p.pi_backfill_episode_count,
  p.pi_backfill_approved,
  COALESCE(ep.cnt, 0) AS episode_count,
  ep.oldest_episode_at,
  ep.latest_episode_at,
  GREATEST(COALESCE(p.pi_backfill_episode_count, 0) - COALESCE(ep.cnt, 0), 0) AS pi_gap,
  CASE
    WHEN p.full_backfill_completed_at IS NULL THEN 'rss_pending'
    WHEN p.pi_backfill_completed_at IS NULL THEN 'pi_pending'
    ELSE 'complete'
  END AS pass_status
FROM podcasts p
LEFT JOIN LATERAL (
  SELECT count(*)::int AS cnt,
         min(published_at) AS oldest_episode_at,
         max(published_at) AS latest_episode_at
  FROM episodes e WHERE e.podcast_id = p.id
) ep ON true
WHERE p.is_hungarian = true
  AND p.language_decision = 'accept_hungarian';

GRANT SELECT ON public.v_hu_archive_completeness TO anon, authenticated;