-- 1) Shared scheduler credential for pg_cron → edge function calls.
INSERT INTO public.internal_job_tokens (job, token)
SELECT 'scheduler', encode(extensions.gen_random_bytes(32), 'hex')
WHERE NOT EXISTS (SELECT 1 FROM public.internal_job_tokens WHERE job = 'scheduler');

-- 2) Every scheduled edge-function call without a token now sends the scheduler token
--    (schedule, active flag and body unchanged).
DO $mig$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT jobid, command FROM cron.job
           WHERE command ILIKE '%functions/v1/%' AND command NOT ILIKE '%x-internal-token%'
  LOOP
    v := regexp_replace(r.command,
      'headers\s*:=\s*(''\{[^'']*\}''::jsonb)',
      'headers := (\1 || jsonb_build_object(''x-internal-token'', (SELECT token FROM public.internal_job_tokens WHERE job = ''scheduler'')))',
      'g');
    v := regexp_replace(v,
      'headers\s*:=\s*jsonb_build_object\(',
      'headers := jsonb_build_object(''x-internal-token'', (SELECT token FROM public.internal_job_tokens WHERE job = ''scheduler''), ',
      'g');
    IF v IS DISTINCT FROM r.command THEN
      PERFORM cron.alter_job(job_id := r.jobid, command := v);
    END IF;
  END LOOP;
END
$mig$;

-- 3) AI spend ledger can only be written by the server.
REVOKE EXECUTE ON FUNCTION public.add_ai_spend(date, text, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_ai_spend(date, text, numeric, integer) TO service_role;

-- 4) Internal caches / pipeline helper tables: no public reads (server code uses the service role;
--    the existing admin policies keep admin access).
DROP POLICY IF EXISTS "pod_emb public read" ON public.podcast_embeddings;
DROP POLICY IF EXISTS "Public read snapshots" ON public.podcast_spotify_snapshots;
CREATE POLICY "Admins read snapshots" ON public.podcast_spotify_snapshots
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "ptm public read" ON public.podcast_topic_map;
DROP POLICY IF EXISTS "pyc public read" ON public.podcast_youtube_candidates;
DROP POLICY IF EXISTS "external demand seeds public read" ON public.search_external_demand_seeds;
DROP POLICY IF EXISTS "search_hyde_cache public read" ON public.search_hyde_cache;
DROP POLICY IF EXISTS "qcache public read" ON public.search_query_cache;
DROP POLICY IF EXISTS "scache public read" ON public.search_suggest_cache;
DROP POLICY IF EXISTS "token_df_cache public read" ON public.token_df_cache;
DROP POLICY IF EXISTS "yt_stats public read" ON public.youtube_channel_stats;

-- 5) Anonymous telemetry / feedback inserts: bounded rows, no impersonation.
DROP POLICY IF EXISTS "anyone can submit feedback" ON public.beta_feedback;
CREATE POLICY "anyone can submit feedback" ON public.beta_feedback
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    handled = false
    AND (user_id IS NULL OR user_id = auth.uid())
    AND length(message) BETWEEN 1 AND 10000
    AND coalesce(length(email), 0) <= 320
    AND coalesce(length(page_url), 0) <= 4096
    AND coalesce(length(viewport), 0) <= 64
    AND coalesce(length(user_agent), 0) <= 1000
    AND coalesce(length(search_query), 0) <= 1000
  );

DROP POLICY IF EXISTS "landing_events public insert" ON public.landing_events;
CREATE POLICY "landing_events public insert" ON public.landing_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(anonymous_session_id) BETWEEN 1 AND 200
    AND length(event_name) BETWEEN 1 AND 100
    AND coalesce(length(path), 0) <= 2048
    AND coalesce(length(referrer_domain), 0) <= 255
    AND coalesce(length(utm_source), 0) <= 255 AND coalesce(length(utm_medium), 0) <= 255
    AND coalesce(length(utm_campaign), 0) <= 255 AND coalesce(length(utm_content), 0) <= 255
    AND coalesce(length(utm_term), 0) <= 255
    AND coalesce(length(landing_variant), 0) <= 100 AND coalesce(length(device_type), 0) <= 50
    AND pg_column_size(meta) <= 16384
  );

DROP POLICY IF EXISTS "anyone can log page view" ON public.page_events;
CREATE POLICY "anyone can log page view" ON public.page_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND length(path) BETWEEN 1 AND 2048
    AND coalesce(length(full_url), 0) <= 4096
    AND coalesce(length(referrer), 0) <= 4096
    AND coalesce(length(session_id), 0) <= 200
    AND coalesce(length(utm_source), 0) <= 255 AND coalesce(length(utm_medium), 0) <= 255
    AND coalesce(length(utm_campaign), 0) <= 255 AND coalesce(length(utm_content), 0) <= 255
    AND coalesce(length(utm_term), 0) <= 255
    AND coalesce(length(ua_browser), 0) <= 100 AND coalesce(length(ua_os), 0) <= 100
    AND (dwell_ms IS NULL OR dwell_ms BETWEEN 0 AND 86400000)
  );

DROP POLICY IF EXISTS "Anyone can insert player events" ON public.player_events;
CREATE POLICY "Anyone can insert player events" ON public.player_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(event_type) BETWEEN 1 AND 64
    AND coalesce(length(session_id), 0) <= 200
    AND coalesce(length(user_agent), 0) <= 1000
    AND pg_column_size(meta) <= 16384
  );

DROP POLICY IF EXISTS "anyone can log search" ON public.search_events;
CREATE POLICY "anyone can log search" ON public.search_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND length(query) BETWEEN 1 AND 1000
    AND pg_column_size(catalog_anchors) <= 16384
    AND (timing IS NULL OR pg_column_size(timing) <= 16384)
    AND (natural_question IS NULL OR pg_column_size(natural_question) <= 16384)
  );

-- 6) Public buckets keep serving files by URL; listing their contents is no longer open.
DROP POLICY IF EXISTS "Sitemaps are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "social-cards public read" ON storage.objects;
CREATE POLICY "social-cards admin read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'social-cards' AND public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "entity-images public read" ON storage.objects;
CREATE POLICY "entity-images admin read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'entity-images' AND public.has_role(auth.uid(), 'admin'::public.app_role));