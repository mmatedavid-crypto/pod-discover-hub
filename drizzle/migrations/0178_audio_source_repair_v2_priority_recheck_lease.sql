-- Audio source repair v2:
-- 1. Queue priority, strict RSS-match requirement, and previous_status tracking.
-- 2. Global HU public catalog rule (language_decision = 'accept_hungarian' AND rss_status <> 'inactive').
-- 3. Automatic rare re-check of expired external_only & broken_no_alternative items with lease filter and lower priority.
-- 4. Strict active-lease ownership check in apply_audio_source_repair_v1 so stale workers cannot overwrite newer work.
-- 5. Idempotent targeted enqueue RPC for double-encoded Archive.org episodes without fabricating error counts.

-- 1. Additive columns & indexes on audio_source_repair_queue
ALTER TABLE public.audio_source_repair_queue
  ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS requires_rss_match boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS previous_status text;

CREATE INDEX IF NOT EXISTS idx_audio_source_repair_queue_due_v2
  ON public.audio_source_repair_queue (status, next_attempt_at)
  WHERE status IN ('pending', 'deferred', 'in_progress', 'external_only', 'broken_no_alternative');

CREATE INDEX IF NOT EXISTS idx_audio_source_repair_queue_priority_due
  ON public.audio_source_repair_queue (priority DESC, next_attempt_at ASC)
  WHERE status IN ('pending', 'deferred', 'external_only', 'broken_no_alternative');

-- 2. Global HU public playback_error capture trigger (accept_hungarian & not inactive)
CREATE OR REPLACE FUNCTION public.tg_player_events_enqueue_audio_repair_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ep record;
  v_err_at timestamptz := coalesce(NEW.created_at, now());
BEGIN
  IF NEW.event_type <> 'playback_error' OR NEW.episode_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.id, e.podcast_id, e.audio_url, e.audio_manual_override
    INTO v_ep
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  WHERE e.id = NEW.episode_id
    AND p.language_decision = 'accept_hungarian'
    AND coalesce(p.rss_status, '') <> 'inactive';

  IF NOT FOUND OR v_ep.audio_manual_override IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.audio_source_repair_queue (
    episode_id, podcast_id, status, trigger_source,
    priority, requires_rss_match,
    error_event_count, error_session_count,
    first_error_at, last_error_at, last_error_meta,
    observed_audio_url, next_attempt_at, updated_at
  ) VALUES (
    v_ep.id, v_ep.podcast_id, 'pending', 'playback_error',
    100, false,
    1, 1,
    v_err_at, v_err_at, NEW.meta,
    v_ep.audio_url, now(), now()
  )
  ON CONFLICT (episode_id) DO UPDATE SET
    trigger_source = 'playback_error',
    priority = greatest(public.audio_source_repair_queue.priority, 100),
    error_event_count = public.audio_source_repair_queue.error_event_count + 1,
    error_session_count = greatest(public.audio_source_repair_queue.error_session_count, 1),
    first_error_at = CASE
      WHEN public.audio_source_repair_queue.error_event_count = 0 THEN v_err_at
      ELSE least(public.audio_source_repair_queue.first_error_at, v_err_at)
    END,
    last_error_at = CASE
      WHEN public.audio_source_repair_queue.error_event_count = 0 THEN v_err_at
      ELSE greatest(public.audio_source_repair_queue.last_error_at, v_err_at)
    END,
    last_error_meta = coalesce(NEW.meta, public.audio_source_repair_queue.last_error_meta),
    observed_audio_url = v_ep.audio_url,
    status = CASE
      WHEN public.audio_source_repair_queue.status IN ('pending', 'in_progress', 'deferred') THEN
        public.audio_source_repair_queue.status
      WHEN public.audio_source_repair_queue.observed_audio_url IS DISTINCT FROM v_ep.audio_url THEN
        'pending'
      WHEN public.audio_source_repair_queue.status = 'already_ok'
           AND coalesce(public.audio_source_repair_queue.resolved_at, '1970-01-01'::timestamptz) < now() - interval '6 hours' THEN
        'pending'
      WHEN public.audio_source_repair_queue.status = 'repaired'
           AND coalesce(public.audio_source_repair_queue.resolved_at, '1970-01-01'::timestamptz) < now() - interval '1 hour' THEN
        'pending'
      WHEN public.audio_source_repair_queue.status IN ('external_only', 'broken_no_alternative')
           AND coalesce(public.audio_source_repair_queue.resolved_at, '1970-01-01'::timestamptz) < now() - interval '7 days' THEN
        'pending'
      ELSE public.audio_source_repair_queue.status
    END,
    next_attempt_at = CASE
      WHEN public.audio_source_repair_queue.status IN ('pending', 'in_progress', 'deferred') THEN
        least(public.audio_source_repair_queue.next_attempt_at, now())
      WHEN public.audio_source_repair_queue.observed_audio_url IS DISTINCT FROM v_ep.audio_url THEN
        now()
      WHEN public.audio_source_repair_queue.status = 'already_ok'
           AND coalesce(public.audio_source_repair_queue.resolved_at, '1970-01-01'::timestamptz) < now() - interval '6 hours' THEN
        now()
      WHEN public.audio_source_repair_queue.status = 'repaired'
           AND coalesce(public.audio_source_repair_queue.resolved_at, '1970-01-01'::timestamptz) < now() - interval '1 hour' THEN
        now()
      WHEN public.audio_source_repair_queue.status IN ('external_only', 'broken_no_alternative')
           AND coalesce(public.audio_source_repair_queue.resolved_at, '1970-01-01'::timestamptz) < now() - interval '7 days' THEN
        now()
      ELSE public.audio_source_repair_queue.next_attempt_at
    END,
    updated_at = now();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- 3. Update 30-day playback_error seed RPC to use the site's HU public rule
CREATE OR REPLACE FUNCTION public.seed_audio_source_repair_queue_30d_v1(
  p_days integer DEFAULT 30,
  p_limit integer DEFAULT 200
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_days integer := greatest(1, least(90, coalesce(p_days, 30)));
  v_limit integer := greatest(1, least(500, coalesce(p_limit, 200)));
  v_count integer := 0;
BEGIN
  WITH agg AS (
    SELECT
      pe.episode_id,
      count(*)::integer AS err_cnt,
      count(DISTINCT pe.session_id)::integer AS sess_cnt,
      min(pe.created_at) AS first_err_at,
      max(pe.created_at) AS last_err_at,
      (array_agg(pe.meta ORDER BY pe.created_at DESC))[1] AS latest_meta
    FROM public.player_events pe
    WHERE pe.event_type = 'playback_error'
      AND pe.episode_id IS NOT NULL
      AND pe.created_at >= now() - make_interval(days => v_days)
    GROUP BY pe.episode_id
    ORDER BY count(DISTINCT pe.session_id) DESC, count(*) DESC, max(pe.created_at) DESC
    LIMIT v_limit
  ),
  upserted AS (
    INSERT INTO public.audio_source_repair_queue (
      episode_id, podcast_id, status, trigger_source,
      priority, requires_rss_match,
      error_event_count, error_session_count,
      first_error_at, last_error_at, last_error_meta,
      observed_audio_url, next_attempt_at, updated_at
    )
    SELECT
      e.id, e.podcast_id, 'pending', 'backfill_30d',
      100, false,
      a.err_cnt, a.sess_cnt,
      a.first_err_at, a.last_err_at, a.latest_meta,
      e.audio_url, now(), now()
    FROM agg a
    JOIN public.episodes e ON e.id = a.episode_id
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE p.language_decision = 'accept_hungarian'
      AND coalesce(p.rss_status, '') <> 'inactive'
      AND e.audio_manual_override IS NULL
    ON CONFLICT (episode_id) DO UPDATE SET
      priority = greatest(public.audio_source_repair_queue.priority, 100),
      trigger_source = CASE
        WHEN public.audio_source_repair_queue.error_event_count = 0 THEN 'backfill_30d'
        ELSE public.audio_source_repair_queue.trigger_source
      END,
      error_event_count = greatest(public.audio_source_repair_queue.error_event_count, excluded.error_event_count),
      error_session_count = greatest(public.audio_source_repair_queue.error_session_count, excluded.error_session_count),
      first_error_at = CASE
        WHEN public.audio_source_repair_queue.error_event_count = 0 THEN excluded.first_error_at
        ELSE least(public.audio_source_repair_queue.first_error_at, excluded.first_error_at)
      END,
      last_error_at = CASE
        WHEN public.audio_source_repair_queue.error_event_count = 0 THEN excluded.last_error_at
        ELSE greatest(public.audio_source_repair_queue.last_error_at, excluded.last_error_at)
      END,
      last_error_meta = coalesce(excluded.last_error_meta, public.audio_source_repair_queue.last_error_meta),
      observed_audio_url = excluded.observed_audio_url,
      updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upserted;

  RETURN v_count;
END;
$$;

-- 4. Idempotent targeted enqueue for double-encoded Archive.org episodes of a confirmed HU show
-- Zero fake error counts (error_event_count=0, error_session_count=0), lower priority (40 < 100),
-- and requires_rss_match=true so items are repaired ONLY after a fresh identical RSS match + live byte probe.
CREATE OR REPLACE FUNCTION public.enqueue_targeted_double_encoded_archive_v1(
  p_podcast_slug text,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit integer := greatest(1, least(1000, coalesce(p_limit, 500)));
  v_podcast record;
  v_eligible integer := 0;
  v_inserted integer := 0;
BEGIN
  SELECT p.id, p.title, p.slug, p.rss_url
    INTO v_podcast
  FROM public.podcasts p
  WHERE p.slug = trim(coalesce(p_podcast_slug, ''))
    AND p.language_decision = 'accept_hungarian'
    AND coalesce(p.rss_status, '') <> 'inactive';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'podcast_not_found_or_not_public_hu');
  END IF;

  SELECT count(*)::integer INTO v_eligible
  FROM public.episodes e
  WHERE e.podcast_id = v_podcast.id
    AND e.audio_url LIKE '%archive.org/download/%'
    AND e.audio_url LIKE '%2520%'
    AND e.audio_manual_override IS NULL
    AND e.audio_health_status <> 'repaired';

  WITH targets AS (
    SELECT e.id, e.podcast_id, e.audio_url
    FROM public.episodes e
    WHERE e.podcast_id = v_podcast.id
      AND e.audio_url LIKE '%archive.org/download/%'
      AND e.audio_url LIKE '%2520%'
      AND e.audio_manual_override IS NULL
      AND e.audio_health_status <> 'repaired'
    ORDER BY e.published_at DESC NULLS LAST, e.id
    LIMIT v_limit
  ),
  ins AS (
    INSERT INTO public.audio_source_repair_queue (
      episode_id, podcast_id, status, trigger_source,
      priority, requires_rss_match,
      error_event_count, error_session_count,
      first_error_at, last_error_at, last_error_meta,
      observed_audio_url, next_attempt_at, updated_at
    )
    SELECT
      t.id, t.podcast_id, 'pending', 'targeted_double_encoded_archive',
      40, true,
      0, 0,
      '1970-01-01T00:00:00Z'::timestamptz, '1970-01-01T00:00:00Z'::timestamptz,
      jsonb_build_object('reason', 'targeted_archive_double_encoding', 'slug', v_podcast.slug),
      t.audio_url, now(), now()
    FROM targets t
    ON CONFLICT (episode_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'ok', true,
    'podcast_id', v_podcast.id,
    'slug', v_podcast.slug,
    'eligible', v_eligible,
    'inserted', v_inserted
  );
END;
$$;

-- 5. Claim RPC v2 with priority tiers, rare re-check of expired external_only & broken_no_alternative,
-- active lease filtering, previous_status tracking, and HU public catalog rule.
CREATE OR REPLACE FUNCTION public.claim_audio_source_repair_queue_v2(
  p_limit integer DEFAULT 8,
  p_lease_seconds integer DEFAULT 300,
  p_owner text DEFAULT 'audio-source-repair'
)
RETURNS TABLE (
  episode_id uuid,
  podcast_id uuid,
  trigger_source text,
  priority smallint,
  requires_rss_match boolean,
  previous_status text,
  error_event_count integer,
  error_session_count integer,
  last_error_at timestamptz,
  attempts integer,
  episode_title text,
  episode_guid text,
  episode_published_at timestamptz,
  episode_duration_seconds integer,
  audio_url text,
  audio_health_status text,
  audio_manual_override text,
  episode_url text,
  spotify_url text,
  apple_url text,
  youtube_url text,
  podcast_title text,
  podcast_rss_url text,
  podcast_website_url text,
  recent_progress_count integer,
  recent_progress_after_last_error integer,
  recent_play_start_count integer,
  best_spotify_meta_url text,
  best_spotify_meta_confidence numeric,
  confirmed_youtube_video_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit integer := greatest(1, least(25, coalesce(p_limit, 8)));
  v_lease integer := greatest(60, least(1800, coalesce(p_lease_seconds, 300)));
BEGIN
  -- Reclaim expired leases cleanly while preserving external_only / broken_no_alternative status
  UPDATE public.audio_source_repair_queue q
     SET status = CASE
           WHEN q.previous_status IN ('external_only', 'broken_no_alternative') THEN q.previous_status
           ELSE 'pending'
         END,
         next_attempt_at = CASE
           WHEN q.previous_status IN ('external_only', 'broken_no_alternative') THEN now() + interval '1 hour'
           ELSE least(q.next_attempt_at, now())
         END,
         lease_owner = NULL,
         lease_expires_at = NULL,
         updated_at = now()
   WHERE q.status = 'in_progress'
     AND q.lease_expires_at IS NOT NULL
     AND q.lease_expires_at < now();

  RETURN QUERY
  WITH picked AS (
    SELECT q.episode_id, q.status AS orig_status
    FROM public.audio_source_repair_queue q
    JOIN public.episodes e ON e.id = q.episode_id
    JOIN public.podcasts p ON p.id = q.podcast_id
    WHERE q.status IN ('pending', 'deferred', 'external_only', 'broken_no_alternative')
      AND q.next_attempt_at <= now()
      AND (q.lease_expires_at IS NULL OR q.lease_expires_at < now())
      AND e.audio_manual_override IS NULL
      AND p.language_decision = 'accept_hungarian'
      AND coalesce(p.rss_status, '') <> 'inactive'
    ORDER BY
      CASE
        WHEN q.status IN ('pending', 'deferred') AND q.priority >= 100 THEN 100
        WHEN q.status IN ('pending', 'deferred') THEN q.priority
        WHEN q.status = 'broken_no_alternative' THEN 20
        WHEN q.status = 'external_only' THEN 10
        ELSE 0
      END DESC,
      q.error_session_count DESC,
      q.error_event_count DESC,
      q.next_attempt_at ASC,
      q.last_error_at DESC
    LIMIT v_limit
    FOR UPDATE OF q SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.audio_source_repair_queue q
       SET previous_status = picked.orig_status,
           status = 'in_progress',
           lease_owner = p_owner,
           lease_expires_at = now() + make_interval(secs => v_lease),
           attempts = q.attempts + 1,
           updated_at = now()
      FROM picked
     WHERE q.episode_id = picked.episode_id
    RETURNING q.*
  )
  SELECT
    c.episode_id,
    c.podcast_id,
    c.trigger_source,
    c.priority,
    c.requires_rss_match,
    c.previous_status,
    c.error_event_count,
    c.error_session_count,
    c.last_error_at,
    c.attempts,
    e.title AS episode_title,
    e.guid AS episode_guid,
    e.published_at AS episode_published_at,
    e.duration_seconds AS episode_duration_seconds,
    e.audio_url,
    e.audio_health_status,
    e.audio_manual_override,
    e.episode_url,
    e.spotify_url,
    e.apple_url,
    e.youtube_url,
    p.title AS podcast_title,
    p.rss_url AS podcast_rss_url,
    p.website_url AS podcast_website_url,
    coalesce((
      SELECT count(*)::integer FROM public.player_events pe
      WHERE pe.episode_id = c.episode_id
        AND pe.event_type IN ('play_25', 'play_50', 'play_75', 'play_complete')
        AND pe.created_at >= now() - interval '14 days'
    ), 0) AS recent_progress_count,
    CASE
      WHEN c.error_event_count > 0 THEN coalesce((
        SELECT count(*)::integer FROM public.player_events pe
        WHERE pe.episode_id = c.episode_id
          AND pe.event_type IN ('play_25', 'play_50', 'play_75', 'play_complete')
          AND pe.created_at > c.last_error_at
      ), 0)
      ELSE 0
    END AS recent_progress_after_last_error,
    coalesce((
      SELECT count(*)::integer FROM public.player_events pe
      WHERE pe.episode_id = c.episode_id
        AND pe.event_type = 'play_start'
        AND pe.created_at >= now() - interval '14 days'
    ), 0) AS recent_play_start_count,
    (
      SELECT sm.spotify_url FROM public.episode_spotify_meta sm
      WHERE sm.episode_id = c.episode_id
        AND sm.spotify_url IS NOT NULL
        AND sm.spotify_url LIKE 'https://open.spotify.com/episode/%'
        AND coalesce(sm.match_confidence, 0) >= 0.85
      ORDER BY sm.match_confidence DESC NULLS LAST, sm.updated_at DESC NULLS LAST
      LIMIT 1
    ) AS best_spotify_meta_url,
    (
      SELECT sm.match_confidence FROM public.episode_spotify_meta sm
      WHERE sm.episode_id = c.episode_id
        AND sm.spotify_url IS NOT NULL
        AND sm.spotify_url LIKE 'https://open.spotify.com/episode/%'
        AND coalesce(sm.match_confidence, 0) >= 0.85
      ORDER BY sm.match_confidence DESC NULLS LAST, sm.updated_at DESC NULLS LAST
      LIMIT 1
    ) AS best_spotify_meta_confidence,
    (
      SELECT yl.youtube_video_id FROM public.episode_youtube_links yl
      WHERE yl.episode_id = c.episode_id
        AND yl.status = 'confirmed'
        AND yl.youtube_video_id IS NOT NULL
      ORDER BY yl.match_score DESC NULLS LAST, yl.updated_at DESC NULLS LAST
      LIMIT 1
    ) AS confirmed_youtube_video_id
  FROM claimed c
  JOIN public.episodes e ON e.id = c.episode_id
  JOIN public.podcasts p ON p.id = c.podcast_id;
END;
$$;

-- Keep v1 delegating to v2 so any legacy caller automatically gets the same priority, lease & re-check rules
CREATE OR REPLACE FUNCTION public.claim_audio_source_repair_queue_v1(
  p_limit integer DEFAULT 8,
  p_lease_seconds integer DEFAULT 300,
  p_owner text DEFAULT 'audio-source-repair'
)
RETURNS TABLE (
  episode_id uuid,
  podcast_id uuid,
  trigger_source text,
  error_event_count integer,
  error_session_count integer,
  last_error_at timestamptz,
  attempts integer,
  episode_title text,
  episode_guid text,
  episode_published_at timestamptz,
  episode_duration_seconds integer,
  audio_url text,
  audio_health_status text,
  audio_manual_override text,
  episode_url text,
  spotify_url text,
  apple_url text,
  youtube_url text,
  podcast_title text,
  podcast_rss_url text,
  podcast_website_url text,
  recent_progress_count integer,
  recent_progress_after_last_error integer,
  recent_play_start_count integer,
  best_spotify_meta_url text,
  best_spotify_meta_confidence numeric,
  confirmed_youtube_video_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    episode_id, podcast_id, trigger_source,
    error_event_count, error_session_count, last_error_at, attempts,
    episode_title, episode_guid, episode_published_at, episode_duration_seconds,
    audio_url, audio_health_status, audio_manual_override,
    episode_url, spotify_url, apple_url, youtube_url,
    podcast_title, podcast_rss_url, podcast_website_url,
    recent_progress_count, recent_progress_after_last_error, recent_play_start_count,
    best_spotify_meta_url, best_spotify_meta_confidence, confirmed_youtube_video_id
  FROM public.claim_audio_source_repair_queue_v2(p_limit, p_lease_seconds, p_owner);
$$;

-- 6. Strict lease-ownership & CAS-protected apply_audio_source_repair_v1
CREATE OR REPLACE FUNCTION public.apply_audio_source_repair_v1(
  p_batch_id text,
  p_episode_id uuid,
  p_expected_audio_url text,
  p_action text,
  p_new_audio_url text DEFAULT NULL,
  p_new_spotify_url text DEFAULT NULL,
  p_new_apple_url text DEFAULT NULL,
  p_new_youtube_url text DEFAULT NULL,
  p_new_episode_url text DEFAULT NULL,
  p_match_method text DEFAULT NULL,
  p_match_evidence jsonb DEFAULT '{}'::jsonb,
  p_probe_status integer DEFAULT NULL,
  p_probe_verdict text DEFAULT NULL,
  p_probe_detail jsonb DEFAULT '{}'::jsonb,
  p_backoff_minutes integer DEFAULT 360,
  p_resolution_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_q public.audio_source_repair_queue%ROWTYPE;
  v_ep public.episodes%ROWTYPE;
  v_audit_id uuid;
  v_after_audio_url text;
  v_after_status text;
  v_after_spotify text;
  v_after_apple text;
  v_after_youtube text;
  v_after_ep_url text;
  v_queue_status text;
  v_next_at timestamptz;
  v_resolved_at timestamptz;
BEGIN
  IF p_action NOT IN ('repaired_audio', 'marked_external_only', 'marked_broken_no_alt', 'marked_ok', 'deferred') THEN
    RAISE EXCEPTION 'Invalid p_action: %', p_action;
  END IF;

  -- Lock queue row first and enforce active lease ownership so a stale/expired worker
  -- can NEVER overwrite a newer worker's lease or completed result.
  SELECT * INTO v_q
  FROM public.audio_source_repair_queue
  WHERE episode_id = p_episode_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'queue_row_not_found');
  END IF;

  IF v_q.status <> 'in_progress' OR v_q.lease_owner IS DISTINCT FROM p_batch_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'stale_lease',
      'current_status', v_q.status,
      'current_lease_owner', v_q.lease_owner
    );
  END IF;

  IF v_q.lease_expires_at IS NOT NULL AND v_q.lease_expires_at < now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'lease_expired',
      'lease_expires_at', v_q.lease_expires_at
    );
  END IF;

  SELECT * INTO v_ep
  FROM public.episodes
  WHERE id = p_episode_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'episode_not_found');
  END IF;

  IF v_ep.audio_manual_override IS NOT NULL THEN
    UPDATE public.audio_source_repair_queue
       SET status = 'skipped_manual',
           previous_status = NULL,
           lease_owner = NULL,
           lease_expires_at = NULL,
           resolution_note = 'manual_override:' || v_ep.audio_manual_override,
           resolved_at = now(),
           updated_at = now()
     WHERE episode_id = p_episode_id
       AND lease_owner = p_batch_id;
    RETURN jsonb_build_object('ok', true, 'outcome', 'skipped_manual', 'override', v_ep.audio_manual_override);
  END IF;

  IF v_ep.audio_url IS DISTINCT FROM p_expected_audio_url THEN
    UPDATE public.audio_source_repair_queue
       SET status = 'pending',
           previous_status = NULL,
           observed_audio_url = v_ep.audio_url,
           lease_owner = NULL,
           lease_expires_at = NULL,
           next_attempt_at = now() + interval '5 minutes',
           resolution_note = 'cas_mismatch_requeued',
           updated_at = now()
     WHERE episode_id = p_episode_id
       AND lease_owner = p_batch_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'cas_mismatch');
  END IF;

  v_after_audio_url := v_ep.audio_url;
  v_after_status := v_ep.audio_health_status;
  v_after_spotify := coalesce(v_ep.spotify_url, p_new_spotify_url);
  v_after_apple := coalesce(v_ep.apple_url, p_new_apple_url);
  v_after_youtube := coalesce(v_ep.youtube_url, p_new_youtube_url);
  v_after_ep_url := coalesce(v_ep.episode_url, p_new_episode_url);
  v_resolved_at := now();

  IF p_action = 'repaired_audio' THEN
    IF p_new_audio_url IS NULL OR length(trim(p_new_audio_url)) < 8 THEN
      RAISE EXCEPTION 'p_new_audio_url required for repaired_audio';
    END IF;
    v_after_audio_url := trim(p_new_audio_url);
    v_after_status := 'repaired';
    v_queue_status := 'repaired';
    v_next_at := now() + interval '30 days';

    PERFORM set_config('podiverzum.audio_repair_bypass', '1', true);
    UPDATE public.episodes
       SET audio_url = v_after_audio_url,
           audio_health_status = 'repaired',
           audio_health_checked_at = now(),
           audio_repaired_at = now(),
           audio_repaired_from = v_ep.audio_url,
           audio_repaired_source = p_match_method,
           spotify_url = v_after_spotify,
           apple_url = v_after_apple,
           youtube_url = v_after_youtube,
           episode_url = v_after_ep_url
     WHERE id = p_episode_id;

  ELSIF p_action = 'marked_external_only' THEN
    IF v_after_spotify IS NULL AND v_after_apple IS NULL AND v_after_youtube IS NULL AND v_after_ep_url IS NULL THEN
      RAISE EXCEPTION 'marked_external_only requires at least one verified episode-level alternative URL';
    END IF;
    v_after_status := 'external_only';
    v_queue_status := 'external_only';
    v_next_at := now() + interval '30 days';

    UPDATE public.episodes
       SET audio_health_status = 'external_only',
           audio_health_checked_at = now(),
           spotify_url = v_after_spotify,
           apple_url = v_after_apple,
           youtube_url = v_after_youtube,
           episode_url = v_after_ep_url
     WHERE id = p_episode_id;

  ELSIF p_action = 'marked_broken_no_alt' THEN
    v_after_status := 'broken_unverified_alt';
    v_queue_status := 'broken_no_alternative';
    v_next_at := now() + make_interval(mins => greatest(60, coalesce(p_backoff_minutes, 10080)));

    UPDATE public.episodes
       SET audio_health_status = 'broken_unverified_alt',
           audio_health_checked_at = now()
     WHERE id = p_episode_id;

  ELSIF p_action = 'marked_ok' THEN
    v_after_status := 'ok';
    v_queue_status := 'already_ok';
    v_next_at := now() + interval '7 days';

    UPDATE public.episodes
       SET audio_health_status = 'ok',
           audio_health_checked_at = now()
     WHERE id = p_episode_id;

  ELSE
    -- Deferred / inconclusive: preserve external_only / broken_no_alternative status during rare re-checks
    IF v_q.previous_status IN ('external_only', 'broken_no_alternative') THEN
      v_queue_status := v_q.previous_status;
      v_resolved_at := v_q.resolved_at;
      v_next_at := now() + make_interval(mins => greatest(60, least(43200, coalesce(p_backoff_minutes, 1440))));
    ELSE
      v_queue_status := 'deferred';
      v_resolved_at := NULL;
      v_next_at := now() + make_interval(mins => greatest(15, least(10080, coalesce(p_backoff_minutes, 360))));
    END IF;
  END IF;

  INSERT INTO public.audio_source_repair_audit (
    batch_id, episode_id, podcast_id, action, match_method, match_evidence,
    before_audio_url, after_audio_url,
    before_audio_health_status, after_audio_health_status,
    before_spotify_url, after_spotify_url,
    before_apple_url, after_apple_url,
    before_youtube_url, after_youtube_url,
    before_episode_url, after_episode_url
  ) VALUES (
    p_batch_id, p_episode_id, v_ep.podcast_id, p_action, p_match_method, coalesce(p_match_evidence, '{}'::jsonb),
    v_ep.audio_url, v_after_audio_url,
    v_ep.audio_health_status, v_after_status,
    v_ep.spotify_url, v_after_spotify,
    v_ep.apple_url, v_after_apple,
    v_ep.youtube_url, v_after_youtube,
    v_ep.episode_url, v_after_ep_url
  ) RETURNING id INTO v_audit_id;

  UPDATE public.audio_source_repair_queue
     SET status = v_queue_status,
         previous_status = NULL,
         observed_audio_url = v_after_audio_url,
         lease_owner = NULL,
         lease_expires_at = NULL,
         next_attempt_at = v_next_at,
         last_probe_status = p_probe_status,
         last_probe_verdict = p_probe_verdict,
         last_probe_detail = p_probe_detail,
         resolution_note = p_resolution_note,
         resolved_at = v_resolved_at,
         updated_at = now()
   WHERE episode_id = p_episode_id
     AND lease_owner = p_batch_id;

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', v_queue_status,
    'recovered_internal', (v_ep.audio_health_status IN ('external_only', 'broken_unverified_alt') AND v_after_status IN ('ok', 'repaired')),
    'audit_id', v_audit_id,
    'episode_id', p_episode_id
  );
END;
$$;

-- Restrict execute permissions to service_role only
REVOKE ALL ON FUNCTION public.enqueue_targeted_double_encoded_archive_v1(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_targeted_double_encoded_archive_v1(text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.claim_audio_source_repair_queue_v2(integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_audio_source_repair_queue_v2(integer, integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.claim_audio_source_repair_queue_v1(integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_audio_source_repair_queue_v1(integer, integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.apply_audio_source_repair_v1(text, uuid, text, text, text, text, text, text, text, text, jsonb, integer, text, jsonb, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_audio_source_repair_v1(text, uuid, text, text, text, text, text, text, text, text, jsonb, integer, text, jsonb, integer, text) TO service_role;

-- 7. Update hourly cron so it also wakes for due external_only/broken_no_alternative re-checks and expired leases
DO $$
DECLARE
  v_existing bigint;
BEGIN
  SELECT jobid INTO v_existing FROM cron.job WHERE jobname = 'podiverzum-audio-source-repair-hourly' LIMIT 1;
  IF v_existing IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing);
  END IF;

  PERFORM cron.schedule(
    'podiverzum-audio-source-repair-hourly',
    '17 * * * *',
    $cmd$
DO $b$
DECLARE tok text := (SELECT token FROM public.internal_job_tokens WHERE job = 'scheduler');
BEGIN
  IF tok IS NULL THEN RETURN; END IF;
  IF NOT COALESCE((SELECT (value->>'enabled')::boolean FROM public.app_settings WHERE key = 'audio_source_repair_controls'), false) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audio_source_repair_queue q
    JOIN public.episodes e ON e.id = q.episode_id
    JOIN public.podcasts p ON p.id = q.podcast_id
    WHERE e.audio_manual_override IS NULL
      AND p.language_decision = 'accept_hungarian'
      AND coalesce(p.rss_status, '') <> 'inactive'
      AND (
        (q.status IN ('pending', 'deferred', 'external_only', 'broken_no_alternative')
         AND q.next_attempt_at <= now()
         AND (q.lease_expires_at IS NULL OR q.lease_expires_at < now()))
        OR (q.status = 'in_progress' AND q.lease_expires_at IS NOT NULL AND q.lease_expires_at < now())
      )
    LIMIT 1
  ) THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/audio-source-repair',
    headers := jsonb_build_object('x-internal-token', tok, 'Content-Type', 'application/json'),
    body := '{"action":"tick","trigger":"cron"}'::jsonb,
    timeout_milliseconds := 60000
  );
END $b$;
    $cmd$
  );
END $$;