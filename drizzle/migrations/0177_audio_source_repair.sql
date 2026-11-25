-- Automatic audio source verification, publisher RSS repair, verified episode-level external fallback,
-- rollback audit, and RSS re-import protection for Podiverzum HU.
-- Zero paid AI, zero server-side audio proxying/downloading.

-- 1. Additive columns on public.episodes (instant metadata-only DDL in PG 11+)
ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS audio_health_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS audio_health_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS audio_repaired_at timestamptz,
  ADD COLUMN IF NOT EXISTS audio_repaired_from text,
  ADD COLUMN IF NOT EXISTS audio_repaired_source text,
  ADD COLUMN IF NOT EXISTS audio_manual_override text;

CREATE INDEX IF NOT EXISTS idx_episodes_audio_health_nondefault
  ON public.episodes (audio_health_status)
  WHERE audio_health_status <> 'unknown';

-- 2. Queue table for automatic playback_error capture & bounded repair passes
CREATE TABLE IF NOT EXISTS public.audio_source_repair_queue (
  episode_id uuid PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  trigger_source text NOT NULL DEFAULT 'playback_error',
  error_event_count integer NOT NULL DEFAULT 1,
  error_session_count integer NOT NULL DEFAULT 1,
  first_error_at timestamptz NOT NULL DEFAULT now(),
  last_error_at timestamptz NOT NULL DEFAULT now(),
  last_error_meta jsonb,
  observed_audio_url text,
  attempts integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_probe_status integer,
  last_probe_verdict text,
  last_probe_detail jsonb,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audio_source_repair_queue_status_chk CHECK (
    status IN (
      'pending', 'in_progress', 'already_ok', 'repaired',
      'external_only', 'broken_no_alternative', 'deferred', 'skipped_manual'
    )
  )
);

GRANT ALL ON public.audio_source_repair_queue TO service_role;
GRANT SELECT ON public.audio_source_repair_queue TO authenticated;

ALTER TABLE public.audio_source_repair_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read audio_source_repair_queue" ON public.audio_source_repair_queue;
CREATE POLICY "admins read audio_source_repair_queue"
  ON public.audio_source_repair_queue
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_audio_source_repair_queue_due
  ON public.audio_source_repair_queue (status, next_attempt_at)
  WHERE status IN ('pending', 'deferred', 'in_progress');

-- 3. Full before/after audit + rollback backup table
CREATE TABLE IF NOT EXISTS public.audio_source_repair_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id text NOT NULL,
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  podcast_id uuid NOT NULL,
  action text NOT NULL,
  match_method text,
  match_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_audio_url text,
  after_audio_url text,
  before_audio_health_status text,
  after_audio_health_status text,
  before_spotify_url text,
  after_spotify_url text,
  before_apple_url text,
  after_apple_url text,
  before_youtube_url text,
  after_youtube_url text,
  before_episode_url text,
  after_episode_url text,
  reverted_at timestamptz,
  reverted_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.audio_source_repair_audit TO service_role;
GRANT SELECT ON public.audio_source_repair_audit TO authenticated;

ALTER TABLE public.audio_source_repair_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read audio_source_repair_audit" ON public.audio_source_repair_audit;
CREATE POLICY "admins read audio_source_repair_audit"
  ON public.audio_source_repair_audit
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_audio_source_repair_audit_ep
  ON public.audio_source_repair_audit (episode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audio_source_repair_audit_batch
  ON public.audio_source_repair_audit (batch_id);

-- 4. Protect repaired / locked audio URLs from being reverted by future RSS imports
CREATE OR REPLACE FUNCTION public.protect_repaired_audio_url_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('podiverzum.audio_repair_bypass', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF OLD.audio_manual_override = 'locked_url' AND NEW.audio_url IS DISTINCT FROM OLD.audio_url THEN
    NEW.audio_url := OLD.audio_url;
    RETURN NEW;
  END IF;

  IF OLD.audio_health_status = 'repaired' AND OLD.audio_url IS NOT NULL THEN
    IF NEW.audio_url IS NULL OR (OLD.audio_repaired_from IS NOT NULL AND NEW.audio_url = OLD.audio_repaired_from) THEN
      NEW.audio_url := OLD.audio_url;
      RETURN NEW;
    END IF;
  END IF;

  IF OLD.audio_health_status IN ('external_only', 'broken_unverified_alt')
     AND NEW.audio_url IS NOT NULL
     AND NEW.audio_url IS DISTINCT FROM OLD.audio_url
     AND COALESCE(OLD.audio_manual_override, '') <> 'external_only' THEN
    NEW.audio_health_status := 'unknown';
    NEW.audio_health_checked_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_repaired_audio_url ON public.episodes;
CREATE TRIGGER trg_protect_repaired_audio_url
  BEFORE UPDATE OF audio_url ON public.episodes
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_repaired_audio_url_v1();

-- 5. Keep episode_cards in sync so proven external_only episodes don't expose a broken inline play button on cards
CREATE OR REPLACE FUNCTION public.episode_cards_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_card_audio text;
BEGIN
  v_card_audio := CASE
    WHEN (NEW.audio_health_status = 'external_only' OR NEW.audio_manual_override = 'external_only')
         AND COALESCE(NEW.audio_manual_override, '') <> 'keep_internal'
      THEN NULL
    ELSE NEW.audio_url
  END;

  INSERT INTO public.episode_cards AS c (
    episode_id, podcast_id, slug, title, display_title, image_url, audio_url,
    published_at, card_summary, people, mentioned, topics, companies, tickers, updated_at
  ) VALUES (
    NEW.id, NEW.podcast_id, NEW.slug, NEW.title, NEW.display_title, NEW.image_url,
    v_card_audio, NEW.published_at,
    left(coalesce(NEW.ai_summary, NEW.summary, ''), 400),
    NEW.people, NEW.mentioned, NEW.topics, NEW.companies, NEW.tickers, now()
  )
  ON CONFLICT (episode_id) DO UPDATE SET
    podcast_id = excluded.podcast_id,
    slug = excluded.slug,
    title = excluded.title,
    display_title = excluded.display_title,
    image_url = excluded.image_url,
    audio_url = excluded.audio_url,
    published_at = excluded.published_at,
    card_summary = excluded.card_summary,
    people = excluded.people,
    mentioned = excluded.mentioned,
    topics = excluded.topics,
    companies = excluded.companies,
    tickers = excluded.tickers,
    updated_at = now();
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS episode_cards_sync_trg ON public.episodes;
CREATE TRIGGER episode_cards_sync_trg
  AFTER INSERT OR UPDATE OF title, display_title, slug, image_url, audio_url, audio_health_status, audio_manual_override, published_at, ai_summary, summary, people, mentioned, topics, companies, tickers, podcast_id
  ON public.episodes
  FOR EACH ROW
  EXECUTE FUNCTION public.episode_cards_sync();

-- 6. Automatic capture trigger on public.player_events for new permanent playback_error events
CREATE OR REPLACE FUNCTION public.tg_player_events_enqueue_audio_repair_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ep record;
BEGIN
  IF NEW.event_type <> 'playback_error' OR NEW.episode_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.id, e.podcast_id, e.audio_url, e.audio_manual_override
    INTO v_ep
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  WHERE e.id = NEW.episode_id
    AND p.language ILIKE 'hu%';

  IF NOT FOUND OR v_ep.audio_manual_override IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.audio_source_repair_queue (
    episode_id, podcast_id, status, trigger_source,
    error_event_count, error_session_count,
    first_error_at, last_error_at, last_error_meta,
    observed_audio_url, next_attempt_at, updated_at
  ) VALUES (
    v_ep.id, v_ep.podcast_id, 'pending', 'playback_error',
    1, 1,
    coalesce(NEW.created_at, now()), coalesce(NEW.created_at, now()), NEW.meta,
    v_ep.audio_url, now(), now()
  )
  ON CONFLICT (episode_id) DO UPDATE SET
    error_event_count = public.audio_source_repair_queue.error_event_count + 1,
    last_error_at = greatest(public.audio_source_repair_queue.last_error_at, coalesce(NEW.created_at, now())),
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
        public.audio_source_repair_queue.next_attempt_at
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

DROP TRIGGER IF EXISTS trg_player_events_enqueue_audio_repair ON public.player_events;
CREATE TRIGGER trg_player_events_enqueue_audio_repair
  AFTER INSERT ON public.player_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'playback_error' AND NEW.episode_id IS NOT NULL)
  EXECUTE FUNCTION public.tg_player_events_enqueue_audio_repair_v1();

-- 7. Seed RPC for initial 30-day playback_error backlog (bounded, never full-catalog)
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
      error_event_count, error_session_count,
      first_error_at, last_error_at, last_error_meta,
      observed_audio_url, next_attempt_at, updated_at
    )
    SELECT
      e.id, e.podcast_id, 'pending', 'backfill_30d',
      a.err_cnt, a.sess_cnt,
      a.first_err_at, a.last_err_at, a.latest_meta,
      e.audio_url, now(), now()
    FROM agg a
    JOIN public.episodes e ON e.id = a.episode_id
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE p.language ILIKE 'hu%'
      AND e.audio_manual_override IS NULL
    ON CONFLICT (episode_id) DO UPDATE SET
      error_event_count = greatest(public.audio_source_repair_queue.error_event_count, excluded.error_event_count),
      error_session_count = greatest(public.audio_source_repair_queue.error_session_count, excluded.error_session_count),
      first_error_at = least(public.audio_source_repair_queue.first_error_at, excluded.first_error_at),
      last_error_at = greatest(public.audio_source_repair_queue.last_error_at, excluded.last_error_at),
      last_error_meta = coalesce(excluded.last_error_meta, public.audio_source_repair_queue.last_error_meta),
      observed_audio_url = excluded.observed_audio_url,
      updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upserted;

  RETURN v_count;
END;
$$;

-- 8. Claim RPC with lease + SKIP LOCKED + recent playback & verified alternative context
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit integer := greatest(1, least(25, coalesce(p_limit, 8)));
  v_lease integer := greatest(60, least(1800, coalesce(p_lease_seconds, 300)));
BEGIN
  UPDATE public.audio_source_repair_queue q
     SET status = 'pending',
         lease_owner = NULL,
         lease_expires_at = NULL,
         updated_at = now()
   WHERE q.status = 'in_progress'
     AND q.lease_expires_at IS NOT NULL
     AND q.lease_expires_at < now();

  RETURN QUERY
  WITH picked AS (
    SELECT q.episode_id
    FROM public.audio_source_repair_queue q
    WHERE q.status IN ('pending', 'deferred')
      AND q.next_attempt_at <= now()
    ORDER BY q.error_session_count DESC, q.error_event_count DESC, q.last_error_at DESC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.audio_source_repair_queue q
       SET status = 'in_progress',
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
    coalesce((
      SELECT count(*)::integer FROM public.player_events pe
      WHERE pe.episode_id = c.episode_id
        AND pe.event_type IN ('play_25', 'play_50', 'play_75', 'play_complete')
        AND pe.created_at > c.last_error_at
    ), 0) AS recent_progress_after_last_error,
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

-- 9. Atomic CAS + Audit + Conditional Apply RPC
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
BEGIN
  IF p_action NOT IN ('repaired_audio', 'marked_external_only', 'marked_broken_no_alt', 'marked_ok', 'deferred') THEN
    RAISE EXCEPTION 'Invalid p_action: %', p_action;
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
           lease_owner = NULL,
           lease_expires_at = NULL,
           resolution_note = 'manual_override:' || v_ep.audio_manual_override,
           resolved_at = now(),
           updated_at = now()
     WHERE episode_id = p_episode_id;
    RETURN jsonb_build_object('ok', true, 'outcome', 'skipped_manual', 'override', v_ep.audio_manual_override);
  END IF;

  IF v_ep.audio_url IS DISTINCT FROM p_expected_audio_url THEN
    UPDATE public.audio_source_repair_queue
       SET status = 'pending',
           observed_audio_url = v_ep.audio_url,
           lease_owner = NULL,
           lease_expires_at = NULL,
           next_attempt_at = now() + interval '5 minutes',
           resolution_note = 'cas_mismatch_requeued',
           updated_at = now()
     WHERE episode_id = p_episode_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'cas_mismatch');
  END IF;

  v_after_audio_url := v_ep.audio_url;
  v_after_status := v_ep.audio_health_status;
  v_after_spotify := coalesce(v_ep.spotify_url, p_new_spotify_url);
  v_after_apple := coalesce(v_ep.apple_url, p_new_apple_url);
  v_after_youtube := coalesce(v_ep.youtube_url, p_new_youtube_url);
  v_after_ep_url := coalesce(v_ep.episode_url, p_new_episode_url);

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
    v_queue_status := 'deferred';
    v_next_at := now() + make_interval(mins => greatest(15, least(10080, coalesce(p_backoff_minutes, 360))));
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
         observed_audio_url = v_after_audio_url,
         lease_owner = NULL,
         lease_expires_at = NULL,
         next_attempt_at = v_next_at,
         last_probe_status = p_probe_status,
         last_probe_verdict = p_probe_verdict,
         last_probe_detail = p_probe_detail,
         resolution_note = p_resolution_note,
         resolved_at = CASE WHEN v_queue_status = 'deferred' THEN NULL ELSE now() END,
         updated_at = now()
   WHERE episode_id = p_episode_id;

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', v_queue_status,
    'audit_id', v_audit_id,
    'episode_id', p_episode_id
  );
END;
$$;

-- 10. Full rollback RPC (by audit_id, batch_id, or latest audit for episode_id)
CREATE OR REPLACE FUNCTION public.revert_audio_source_repair_v1(
  p_audit_id uuid DEFAULT NULL,
  p_batch_id text DEFAULT NULL,
  p_episode_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'manual_rollback'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_reverted integer := 0;
BEGIN
  IF p_audit_id IS NULL AND p_batch_id IS NULL AND p_episode_id IS NULL THEN
    RAISE EXCEPTION 'At least one of p_audit_id, p_batch_id, or p_episode_id must be provided';
  END IF;

  PERFORM set_config('podiverzum.audio_repair_bypass', '1', true);

  FOR r IN
    SELECT DISTINCT ON (a.episode_id) a.*
    FROM public.audio_source_repair_audit a
    WHERE a.reverted_at IS NULL
      AND a.action IN ('repaired_audio', 'marked_external_only', 'marked_broken_no_alt', 'marked_ok')
      AND (p_audit_id IS NULL OR a.id = p_audit_id)
      AND (p_batch_id IS NULL OR a.batch_id = p_batch_id)
      AND (p_episode_id IS NULL OR a.episode_id = p_episode_id)
    ORDER BY a.episode_id, a.created_at DESC
  LOOP
    UPDATE public.episodes
       SET audio_url = r.before_audio_url,
           audio_health_status = coalesce(r.before_audio_health_status, 'unknown'),
           audio_health_checked_at = NULL,
           audio_repaired_at = CASE WHEN r.action = 'repaired_audio' THEN NULL ELSE audio_repaired_at END,
           audio_repaired_from = CASE WHEN r.action = 'repaired_audio' THEN NULL ELSE audio_repaired_from END,
           audio_repaired_source = CASE WHEN r.action = 'repaired_audio' THEN NULL ELSE audio_repaired_source END,
           spotify_url = r.before_spotify_url,
           apple_url = r.before_apple_url,
           youtube_url = r.before_youtube_url,
           episode_url = r.before_episode_url
     WHERE id = r.episode_id;

    UPDATE public.audio_source_repair_audit
       SET reverted_at = now(),
           reverted_by = coalesce(p_reason, 'manual_rollback')
     WHERE id = r.id;

    UPDATE public.audio_source_repair_queue
       SET status = 'pending',
           observed_audio_url = r.before_audio_url,
           lease_owner = NULL,
           lease_expires_at = NULL,
           next_attempt_at = now() + interval '1 hour',
           resolution_note = 'reverted:' || coalesce(p_reason, 'manual_rollback'),
           resolved_at = NULL,
           updated_at = now()
     WHERE episode_id = r.episode_id;

    v_reverted := v_reverted + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'reverted', v_reverted);
END;
$$;

REVOKE ALL ON FUNCTION public.seed_audio_source_repair_queue_30d_v1(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_audio_source_repair_queue_30d_v1(integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.claim_audio_source_repair_queue_v1(integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_audio_source_repair_queue_v1(integer, integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.apply_audio_source_repair_v1(text, uuid, text, text, text, text, text, text, text, text, jsonb, integer, text, jsonb, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_audio_source_repair_v1(text, uuid, text, text, text, text, text, text, text, text, jsonb, integer, text, jsonb, integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.revert_audio_source_repair_v1(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revert_audio_source_repair_v1(uuid, text, uuid, text) TO service_role;

-- 11. Runner controls in app_settings (idempotent)
INSERT INTO public.app_settings (key, value)
VALUES (
  'audio_source_repair_controls',
  jsonb_build_object(
    'enabled', true,
    'per_run', 8,
    'lease_seconds', 300,
    'time_budget_ms', 45000,
    'defer_backoff_minutes', 360,
    'max_defer_attempts', 6,
    'recheck_broken_no_alt_hours', 168,
    'note', 'Deterministic $0 audio source probe + publisher RSS repair + verified episode-level fallback. Hourly cron checks due rows before invoking.'
  )
)
ON CONFLICT (key) DO NOTHING;

-- 12. Low-load hourly cron: checks for due rows BEFORE firing HTTP
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
    SELECT 1 FROM public.audio_source_repair_queue
    WHERE status IN ('pending', 'deferred') AND next_attempt_at <= now()
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