-- Phase B prep: pause Formula C live + shadow writes by switching cron payload to dry_run.
-- Runner code already short-circuits all DB writes (live + shadow + app_settings) when dry_run=true.
SELECT cron.alter_job(
  job_id := 10,
  command := $$SELECT net.http_post(
    url:='https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/formula-c-runner',
    headers:='{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8", "Content-Type": "application/json"}'::jsonb,
    body:='{"trigger":"cron","limit":200,"dry_run":true}'::jsonb
  )$$
);

-- RPC: market popularity from podcast_charts (HU), reused by hu-formula-v1-shadow runner.
CREATE OR REPLACE FUNCTION public.hu_market_popularity()
RETURNS TABLE(podcast_id uuid, rrf_score numeric, source_count int, sources jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH latest_snap AS (
    SELECT source, max(snapshot_at) AS snap
    FROM public.podcast_charts
    WHERE country='hu' AND snapshot_at > now() - interval '30 days'
    GROUP BY source
  ),
  current_charts AS (
    SELECT c.podcast_id, c.source, c.rank, c.snapshot_at
    FROM public.podcast_charts c
    JOIN latest_snap ls ON ls.source=c.source AND ls.snap=c.snapshot_at
    WHERE c.podcast_id IS NOT NULL
  )
  SELECT
    podcast_id,
    sum(1.0/(60.0+rank))::numeric AS rrf_score,
    count(DISTINCT source)::int AS source_count,
    jsonb_agg(jsonb_build_object('source',source,'rank',rank) ORDER BY rank) AS sources
  FROM current_charts
  GROUP BY podcast_id;
$$;

GRANT EXECUTE ON FUNCTION public.hu_market_popularity() TO authenticated, service_role, anon;

-- Activity helper: recent episode counts per podcast in last 90 / 180 days.
CREATE OR REPLACE FUNCTION public.hu_recent_activity(_ids uuid[])
RETURNS TABLE(podcast_id uuid, eps_90d int, eps_180d int, last_ep_at timestamptz, avg_ep_title_len numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    e.podcast_id,
    count(*) FILTER (WHERE e.published_at >= now()-interval '90 days')::int AS eps_90d,
    count(*) FILTER (WHERE e.published_at >= now()-interval '180 days')::int AS eps_180d,
    max(e.published_at) AS last_ep_at,
    avg(length(coalesce(e.title,'')))::numeric AS avg_ep_title_len
  FROM public.episodes e
  WHERE e.podcast_id = ANY(_ids)
    AND e.published_at >= now()-interval '365 days'
  GROUP BY e.podcast_id;
$$;

GRANT EXECUTE ON FUNCTION public.hu_recent_activity(uuid[]) TO authenticated, service_role, anon;