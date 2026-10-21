-- Legacy `deterministic_v4+ytdesc` lane inside the existing clean-text repair
-- queue (no new cron). Regular RSS repairs and RSS-change rows are claimed first
-- (lane 'regular'); legacy rows are evaluated once by the deterministic legacy
-- planner (lane 'legacy', risky rows without a confirmed YouTube link first).
-- Writes still go only through apply_clean_text_repair_v1 (backup + CAS).

CREATE OR REPLACE FUNCTION public.claim_clean_text_repair_queue_v2(
  p_owner text, p_limit integer DEFAULT 40, p_lease_seconds integer DEFAULT 600, p_lane text DEFAULT 'regular')
RETURNS TABLE(episode_id uuid, repair_kind text, source_fingerprint text, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(p_owner, '') = '' THEN RAISE EXCEPTION 'owner required'; END IF;
  IF p_lane NOT IN ('regular', 'legacy') THEN RAISE EXCEPTION 'invalid lane %', p_lane; END IF;
  UPDATE public.clean_text_repair_queue q
    SET status = 'dead', outcome = 'lease_expired_max_attempts', lease_owner = NULL, lease_until = NULL,
        resolved_at = now(), updated_at = now()
  WHERE q.status = 'leased' AND q.lease_until < now() AND q.attempts >= q.max_attempts;
  IF p_lane = 'regular' THEN
    RETURN QUERY
    WITH c AS (
      SELECT q.episode_id FROM public.clean_text_repair_queue q
      WHERE q.repair_kind <> 'legacy_ytdesc'
        AND ((q.status IN ('pending','retry') AND q.next_attempt_at <= now())
          OR (q.status = 'leased' AND q.lease_until < now()))
      ORDER BY q.priority, q.published_at DESC NULLS LAST, q.episode_id
      LIMIT least(greatest(coalesce(p_limit, 40), 1), 100)
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.clean_text_repair_queue q
      SET status = 'leased', lease_owner = p_owner,
          lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 600), 60), 3600)),
          attempts = q.attempts + 1, updated_at = now()
    FROM c WHERE q.episode_id = c.episode_id
    RETURNING q.episode_id, q.repair_kind, q.source_fingerprint, q.attempts;
  ELSE
    RETURN QUERY
    WITH c AS (
      SELECT q.episode_id FROM public.clean_text_repair_queue q
      WHERE q.repair_kind = 'legacy_ytdesc'
        AND ((q.status = 'needs_review' AND q.outcome = 'legacy_ytdesc_separate_review')
          OR (q.status IN ('pending','retry') AND q.next_attempt_at <= now())
          OR (q.status = 'leased' AND q.lease_until < now()))
      ORDER BY EXISTS (SELECT 1 FROM public.episode_youtube_links l WHERE l.episode_id = q.episode_id AND l.status = 'confirmed'),
        q.published_at DESC NULLS LAST, q.episode_id
      LIMIT least(greatest(coalesce(p_limit, 40), 1), 50)
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.clean_text_repair_queue q
      SET status = 'leased', lease_owner = p_owner,
          lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 600), 60), 3600)),
          attempts = q.attempts + 1, updated_at = now()
    FROM c WHERE q.episode_id = c.episode_id
    RETURNING q.episode_id, q.repair_kind, q.source_fingerprint, q.attempts;
  END IF;
END;
$$;

-- Admin canary / re-check: lease explicit legacy rows (any finite state, never an active lease).
CREATE OR REPLACE FUNCTION public.claim_clean_text_repair_queue_ids_v1(p_owner text, p_ids uuid[], p_lease_seconds integer DEFAULT 600)
RETURNS TABLE(episode_id uuid, repair_kind text, source_fingerprint text, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(p_owner, '') = '' THEN RAISE EXCEPTION 'owner required'; END IF;
  IF coalesce(array_length(p_ids, 1), 0) > 50 THEN RAISE EXCEPTION 'at most 50 ids'; END IF;
  RETURN QUERY
  WITH c AS (
    SELECT q.episode_id FROM public.clean_text_repair_queue q
    WHERE q.episode_id = ANY(p_ids) AND q.repair_kind = 'legacy_ytdesc'
      AND NOT (q.status = 'leased' AND q.lease_until >= now())
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.clean_text_repair_queue q
    SET status = 'leased', lease_owner = p_owner,
        lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 600), 60), 3600)),
        attempts = 1, updated_at = now()
  FROM c WHERE q.episode_id = c.episode_id
  RETURNING q.episode_id, q.repair_kind, q.source_fingerprint, q.attempts;
END;
$$;

-- Grounded inputs for the legacy planner: episode, stored clean text, active
-- backups (with batch + reasons), YouTube links with exact source-hash
-- provenance and duplicate-video use, show channels, best Spotify match.
CREATE OR REPLACE FUNCTION public.clean_text_repair_queue_legacy_inputs_v1(p_episode_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH base AS (
    SELECT e.id, e.podcast_id, e.title, e.published_at, e.description, e.summary, e.clean_text_status,
      p.title AS podcast_title, p.spotify_match_confidence AS show_sp_conf, (p.language_decision = 'accept_hungarian') AS is_hungarian,
      c.cleaned_text, c.source_hash, c.cleaner_method, c.removed_categories, (c.episode_id IS NOT NULL) AS has_clean_row,
      b.source_type AS best_type,
      (SELECT count(*)::int FROM public.episodes e2 WHERE e2.podcast_id = e.podcast_id AND e2.description = e.description) AS same_desc
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    LEFT JOIN public.episode_clean_text c ON c.episode_id = e.id
    LEFT JOIN public.episode_best_text_source b ON b.episode_id = e.id
    WHERE e.id = ANY(p_episode_ids[1:50])
  )
  SELECT coalesce(jsonb_agg(to_jsonb(base) || jsonb_build_object(
    'backups', (SELECT coalesce(jsonb_agg(jsonb_build_object('batch_id', k.batch_id, 'method', k.new_cleaner_method, 'reasons', k.reasons)), '[]')
                FROM public.episode_clean_text_repair_backups k WHERE k.episode_id = base.id AND k.rolled_back_at IS NULL),
    'links', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'video_id', l.youtube_video_id, 'channel_id', l.youtube_channel_id, 'status', l.status, 'confidence', l.confidence,
        'title', l.youtube_title, 'published_at', l.youtube_published_at, 'match_score', l.match_score,
        'vr', coalesce(l.validation_reason, '{}'::jsonb) - 'rank', 'description', l.youtube_description, 'prov', x.prov,
        'video_confirmed_elsewhere', (SELECT count(*) FROM public.episode_youtube_links l2
           WHERE l2.youtube_video_id = l.youtube_video_id AND l2.status = 'confirmed' AND l2.episode_id <> l.episode_id),
        'elsewhere_titles', (SELECT coalesce(jsonb_agg(e3.title), '[]') FROM public.episode_youtube_links l2 JOIN public.episodes e3 ON e3.id = l2.episode_id
           WHERE l2.youtube_video_id = l.youtube_video_id AND l2.status = 'confirmed' AND l2.episode_id <> l.episode_id)
      ) ORDER BY l.match_score DESC NULLS LAST), '[]')
      FROM public.episode_youtube_links l
      CROSS JOIN LATERAL (SELECT base.source_hash IN (
          encode(sha256(convert_to('deterministic_v4+ytdesc::' || btrim(coalesce(l.youtube_description, '')), 'UTF8')), 'hex'),
          encode(sha256(convert_to('deterministic_v4+ytdesc::' || coalesce(l.youtube_description, ''), 'UTF8')), 'hex')) AS prov) x
      WHERE l.episode_id = base.id AND (l.status <> 'rejected' OR x.prov)),
    'show_channels', (SELECT coalesce(jsonb_object_agg(ch, n), '{}') FROM (
        SELECT l.youtube_channel_id AS ch, count(*) AS n FROM public.episode_youtube_links l
        WHERE l.podcast_id = base.podcast_id AND l.status = 'confirmed' AND l.youtube_channel_id IS NOT NULL GROUP BY 1) sc),
    'spotify', (SELECT to_jsonb(s) FROM (
        SELECT m.match_confidence, m.spotify_description, m.spotify_html_description
        FROM public.episode_spotify_meta m WHERE m.episode_id = base.id ORDER BY m.match_confidence DESC NULLS LAST LIMIT 1) s)
  )), '[]'::jsonb) FROM base;
$$;

CREATE OR REPLACE FUNCTION public.clean_text_repair_queue_status_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'by_status', (SELECT coalesce(jsonb_object_agg(status, n), '{}') FROM (SELECT status, count(*) n FROM public.clean_text_repair_queue GROUP BY status) s),
    'by_kind_status', (SELECT coalesce(jsonb_object_agg(k, n), '{}') FROM (SELECT repair_kind || ':' || status AS k, count(*) n FROM public.clean_text_repair_queue GROUP BY 1) s),
    'by_outcome', (SELECT coalesce(jsonb_object_agg(coalesce(outcome,'none'), n), '{}') FROM (SELECT outcome, count(*) n FROM public.clean_text_repair_queue GROUP BY outcome) s),
    'claimable', (SELECT count(*) FROM public.clean_text_repair_queue WHERE repair_kind <> 'legacy_ytdesc' AND ((status IN ('pending','retry') AND next_attempt_at <= now()) OR (status = 'leased' AND lease_until < now()))),
    'open', (SELECT count(*) FROM public.clean_text_repair_queue WHERE repair_kind <> 'legacy_ytdesc' AND status IN ('pending','retry','leased')),
    'leased_expired', (SELECT count(*) FROM public.clean_text_repair_queue WHERE status = 'leased' AND lease_until < now()),
    'applied_today', (SELECT count(*) FROM public.clean_text_repair_queue WHERE outcome = 'applied' AND resolved_at >= date_trunc('day', now())),
    'unique_applied', (SELECT count(*) FROM public.clean_text_repair_queue WHERE outcome = 'applied'),
    'legacy_open', (SELECT count(*) FROM public.clean_text_repair_queue WHERE repair_kind = 'legacy_ytdesc'
        AND ((status = 'needs_review' AND outcome = 'legacy_ytdesc_separate_review') OR status IN ('pending','retry','leased'))),
    'legacy_writes_today', (SELECT count(*) FROM public.clean_text_repair_queue WHERE repair_kind = 'legacy_ytdesc'
        AND (outcome = 'legacy_verified_youtube_kept' OR outcome LIKE 'legacy\_%\_applied') AND resolved_at >= date_trunc('day', now())),
    'oldest_open_enqueued_at', (SELECT min(enqueued_at) FROM public.clean_text_repair_queue WHERE status IN ('pending','retry','leased')));
$$;

REVOKE ALL ON FUNCTION public.claim_clean_text_repair_queue_v2(text, integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_clean_text_repair_queue_ids_v1(text, uuid[], integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clean_text_repair_queue_legacy_inputs_v1(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clean_text_repair_queue_status_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_clean_text_repair_queue_v2(text, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_clean_text_repair_queue_ids_v1(text, uuid[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.clean_text_repair_queue_legacy_inputs_v1(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.clean_text_repair_queue_status_v1() TO service_role;