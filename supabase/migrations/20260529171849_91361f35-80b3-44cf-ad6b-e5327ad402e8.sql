
-- Phase B QA fix: chart freshness reporting RPC for HU_v1 shadow scoring.
-- Read-only helper. No mutation of live rank fields.
CREATE OR REPLACE FUNCTION public.hu_chart_freshness()
RETURNS TABLE(source text, latest_snapshot timestamptz, days_old int, rows_in_latest int, stale boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH per_src AS (
    SELECT source, max(snapshot_at) AS snap
    FROM public.podcast_charts
    WHERE country = 'hu'
    GROUP BY source
  )
  SELECT
    ps.source,
    ps.snap AS latest_snapshot,
    GREATEST(0, (EXTRACT(EPOCH FROM (now() - ps.snap)) / 86400)::int) AS days_old,
    (SELECT count(*)::int FROM public.podcast_charts c
       WHERE c.country = 'hu' AND c.source = ps.source AND c.snapshot_at = ps.snap) AS rows_in_latest,
    (ps.snap < now() - interval '7 days') AS stale
  FROM per_src ps
  ORDER BY ps.source;
$$;

GRANT EXECUTE ON FUNCTION public.hu_chart_freshness() TO anon, authenticated, service_role;
