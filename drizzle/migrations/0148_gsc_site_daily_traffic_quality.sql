-- A) Measurement fixes: real Search Console site totals per day + one server-side traffic report
-- with the same definitions for every day (duplicates, bots and Search Console shown separately).

CREATE TABLE IF NOT EXISTS public.gsc_site_daily (
  site_url text NOT NULL,
  date date NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  ctr double precision NOT NULL DEFAULT 0,
  position double precision NOT NULL DEFAULT 0,
  data_state text NOT NULL DEFAULT 'final' CHECK (data_state IN ('final','partial')),
  totals_fetched_at timestamptz NOT NULL DEFAULT now(),
  detail_rows integer,
  detail_clicks integer,
  detail_impressions integer,
  detail_complete boolean NOT NULL DEFAULT false,
  detail_fetched_at timestamptz,
  PRIMARY KEY (site_url, date)
);
COMMENT ON TABLE public.gsc_site_daily IS 'Search Console whole-site totals per GSC day (Pacific time, Google definition, includes anonymised queries) and coverage of the query+page detail rows in gsc_query_daily.';
GRANT SELECT ON public.gsc_site_daily TO authenticated;
GRANT ALL ON public.gsc_site_daily TO service_role;
ALTER TABLE public.gsc_site_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read gsc_site_daily" ON public.gsc_site_daily FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.get_traffic_quality_v1(p_days integer DEFAULT 14)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 14), 1), 90);
  v_today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  v_from_day date;
  v_from timestamptz;
  v_out jsonb;
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role' OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_from_day := v_today - (v_days - 1);
  v_from := (v_from_day::timestamp AT TIME ZONE 'Europe/Budapest');

  WITH pe AS (
    SELECT p.*,
      (p.created_at AT TIME ZONE 'Europe/Budapest')::date AS day,
      lag(p.created_at) OVER (PARTITION BY p.session_id, p.full_url ORDER BY p.created_at) AS prev_same
    FROM public.page_events p
    WHERE p.created_at >= v_from
  ), pv AS (
    SELECT pe.*,
      (pe.session_id IS NOT NULL AND pe.prev_same IS NOT NULL AND pe.created_at - pe.prev_same < interval '5 seconds') AS is_dup
    FROM pe
  ), views AS (
    SELECT * FROM pv WHERE NOT is_dup
  ), landing AS (
    SELECT DISTINCT ON (session_id) session_id, day, is_bot, referrer, path, created_at
    FROM views WHERE session_id IS NOT NULL
    ORDER BY session_id, created_at
  ), human_sessions AS (
    SELECT session_id FROM landing WHERE NOT COALESCE(is_bot, false)
  ), search_first AS (
    SELECT v.session_id, min(v.created_at) AS first_search_at
    FROM views v JOIN human_sessions h USING (session_id)
    WHERE v.path = '/kereses'
    GROUP BY v.session_id
  ), plays AS (
    SELECT e.session_id, e.event_type, e.created_at, (e.created_at AT TIME ZONE 'Europe/Budapest')::date AS day
    FROM public.player_events e
    WHERE e.created_at >= v_from AND e.event_type IN ('play_start','playback_error','play_seek','play_25')
  ), days AS (
    SELECT d::date AS day FROM generate_series(v_from_day, v_today, interval '1 day') d
  ), a_pv AS (
    SELECT day, count(*) AS raw_rows, count(*) FILTER (WHERE is_dup) AS duplicate_rows,
      count(*) FILTER (WHERE NOT is_dup) AS views_all,
      count(*) FILTER (WHERE NOT is_dup AND COALESCE(is_bot,false)) AS views_bot,
      count(*) FILTER (WHERE NOT is_dup AND NOT COALESCE(is_bot,false)) AS views_human,
      count(*) FILTER (WHERE NOT is_dup AND dwell_ms IS NOT NULL) AS views_with_dwell
    FROM pv GROUP BY day
  ), a_land AS (
    SELECT day, count(*) AS sessions_all,
      count(*) FILTER (WHERE COALESCE(is_bot,false)) AS sessions_bot,
      count(*) FILTER (WHERE NOT COALESCE(is_bot,false)) AS sessions_human,
      count(*) FILTER (WHERE NOT COALESCE(is_bot,false) AND referrer ~* '^https?://([a-z0-9-]+\.)*google\.') AS landings_human_google,
      count(*) FILTER (WHERE NOT COALESCE(is_bot,false) AND referrer IS NOT NULL AND referrer !~* '^https?://([a-z0-9-]+\.)*podiverzum\.hu') AS landings_human_external,
      count(*) FILTER (WHERE NOT COALESCE(is_bot,false) AND referrer IS NULL) AS landings_human_no_referrer
    FROM landing GROUP BY day
  ), a_play AS (
    SELECT day,
      count(DISTINCT session_id) FILTER (WHERE event_type = 'play_start') AS play_start_sessions,
      count(DISTINCT session_id) FILTER (WHERE event_type = 'play_25') AS play_25_sessions,
      count(DISTINCT session_id) FILTER (WHERE event_type = 'playback_error') AS playback_error_sessions,
      count(*) FILTER (WHERE event_type = 'play_seek') AS play_seek_raw
    FROM plays GROUP BY day
  ), a_search AS (
    SELECT (s.first_search_at AT TIME ZONE 'Europe/Budapest')::date AS day, count(*) AS search_sessions_human,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM plays p WHERE p.session_id = s.session_id
        AND p.event_type = 'play_start' AND p.created_at > s.first_search_at)) AS search_to_play_sessions
    FROM search_first s GROUP BY 1
  ), per_day AS (
    SELECT dd.day,
      COALESCE(a.raw_rows,0) raw_rows, COALESCE(a.duplicate_rows,0) duplicate_rows, COALESCE(a.views_all,0) views_all,
      COALESCE(a.views_bot,0) views_bot, COALESCE(a.views_human,0) views_human, COALESCE(a.views_with_dwell,0) views_with_dwell,
      COALESCE(l.sessions_all,0) sessions_all, COALESCE(l.sessions_bot,0) sessions_bot, COALESCE(l.sessions_human,0) sessions_human,
      COALESCE(l.landings_human_google,0) landings_human_google, COALESCE(l.landings_human_external,0) landings_human_external,
      COALESCE(l.landings_human_no_referrer,0) landings_human_no_referrer,
      COALESCE(p.play_start_sessions,0) play_start_sessions, COALESCE(p.play_25_sessions,0) play_25_sessions,
      COALESCE(p.playback_error_sessions,0) playback_error_sessions, COALESCE(p.play_seek_raw,0) play_seek_raw,
      COALESCE(s.search_sessions_human,0) search_sessions_human, COALESCE(s.search_to_play_sessions,0) search_to_play_sessions,
      g.clicks AS gsc_clicks, g.impressions AS gsc_impressions, g.data_state AS gsc_state
    FROM days dd
    LEFT JOIN a_pv a ON a.day = dd.day
    LEFT JOIN a_land l ON l.day = dd.day
    LEFT JOIN a_play p ON p.day = dd.day
    LEFT JOIN a_search s ON s.day = dd.day
    LEFT JOIN public.gsc_site_daily g ON g.site_url = 'sc-domain:podiverzum.hu' AND g.date = dd.day
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'timezone', 'Europe/Budapest',
    'from_utc', v_from,
    'to_utc', now(),
    'days_requested', v_days,
    'today_is_partial', true,
    'gsc_latest_final', (SELECT max(date) FROM public.gsc_site_daily WHERE site_url = 'sc-domain:podiverzum.hu' AND data_state = 'final'),
    'gsc_latest_any', (SELECT max(date) FROM public.gsc_site_daily WHERE site_url = 'sc-domain:podiverzum.hu'),
    'gsc_last_fetch', (SELECT max(totals_fetched_at) FROM public.gsc_site_daily WHERE site_url = 'sc-domain:podiverzum.hu'),
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'day', day,
        'utc_start', (day::timestamp AT TIME ZONE 'Europe/Budapest'),
        'utc_end', ((day + 1)::timestamp AT TIME ZONE 'Europe/Budapest'),
        'partial', day = v_today,
        'raw_rows', raw_rows, 'duplicate_rows', duplicate_rows,
        'views_all', views_all, 'views_bot', views_bot, 'views_human', views_human, 'views_with_dwell', views_with_dwell,
        'sessions_all', sessions_all, 'sessions_bot', sessions_bot, 'sessions_human', sessions_human,
        'landings_human_google', landings_human_google, 'landings_human_external', landings_human_external,
        'landings_human_no_referrer', landings_human_no_referrer,
        'play_start_sessions', play_start_sessions, 'play_25_sessions', play_25_sessions,
        'playback_error_sessions', playback_error_sessions, 'play_seek_raw', play_seek_raw,
        'search_sessions_human', search_sessions_human, 'search_to_play_sessions', search_to_play_sessions,
        'gsc_clicks', gsc_clicks, 'gsc_impressions', gsc_impressions, 'gsc_state', COALESCE(gsc_state, 'missing')
      ) ORDER BY day) FROM per_day), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.get_traffic_quality_v1(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_traffic_quality_v1(integer) TO authenticated, service_role;