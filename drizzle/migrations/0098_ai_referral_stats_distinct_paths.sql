CREATE OR REPLACE FUNCTION public.get_ai_referral_stats_v1(p_days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days int := greatest(1, least(coalesce(p_days, 30), 90));
  v_since timestamptz := now() - make_interval(days => v_days);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  WITH ev AS (
    SELECT session_id, path, created_at, referrer, utm_source
    FROM page_events
    WHERE created_at >= v_since AND NOT coalesce(is_bot, false) AND session_id IS NOT NULL
  ), firsts AS (
    SELECT DISTINCT ON (session_id) session_id, path, created_at,
           public.classify_ai_referral_v1(referrer, utm_source) AS src,
           lower(coalesce(substring(referrer from '^https?://([^/?#]+)'), '')) AS ref_host
    FROM ev ORDER BY session_id, created_at
  ), ai AS (
    SELECT * FROM firsts WHERE src IS NOT NULL
  ), pages AS (
    -- distinct paths: one landing can log twice (e.g. URL query cleanup), which is not a second page
    SELECT session_id, count(DISTINCT path) n FROM ev WHERE session_id IN (SELECT session_id FROM ai) GROUP BY 1
  ), plays AS (
    SELECT DISTINCT session_id FROM player_events
    WHERE created_at >= v_since AND event_type = 'play_start'
      AND session_id IN (SELECT session_id FROM ai)
  ), totals AS (
    SELECT count(*) AS all_sessions,
           count(*) FILTER (WHERE ref_host ~ '(^|\.)google\.') AS google_sessions
    FROM firsts
  )
  SELECT jsonb_build_object(
    'days', v_days,
    'generated_at', now(),
    'all_sessions', (SELECT all_sessions FROM totals),
    'google_sessions', (SELECT google_sessions FROM totals),
    'sources', coalesce((
      SELECT jsonb_agg(row_to_json(s) ORDER BY s.sessions DESC) FROM (
        SELECT a.src AS source, count(*) AS sessions,
               round(avg(p.n)::numeric, 2) AS pages_per_session,
               round(100.0 * count(*) FILTER (WHERE p.n = 1) / count(*), 1) AS bounce_pct,
               count(pl.session_id) AS play_sessions,
               count(*) FILTER (WHERE a.path ~ '^/podcast/[^/]+/[^/]+') AS episode_landings,
               count(*) FILTER (WHERE a.path ~ '^/podcast/[^/]+/?$') AS podcast_landings
        FROM ai a LEFT JOIN pages p USING (session_id) LEFT JOIN plays pl USING (session_id)
        GROUP BY a.src) s), '[]'::jsonb),
    'weekly', coalesce((
      SELECT jsonb_agg(row_to_json(w) ORDER BY w.week, w.source) FROM (
        SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week, src AS source, count(*) AS sessions
        FROM ai GROUP BY 1, 2) w), '[]'::jsonb),
    'landings', coalesce((
      SELECT jsonb_agg(row_to_json(l) ORDER BY l.sessions DESC) FROM (
        SELECT a.path, string_agg(DISTINCT a.src, ', ') AS sources, count(*) AS sessions,
               count(pl.session_id) AS play_sessions
        FROM ai a LEFT JOIN plays pl USING (session_id)
        GROUP BY a.path ORDER BY count(*) DESC LIMIT 40) l), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_ai_referral_stats_v1(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_referral_stats_v1(int) TO authenticated, service_role;