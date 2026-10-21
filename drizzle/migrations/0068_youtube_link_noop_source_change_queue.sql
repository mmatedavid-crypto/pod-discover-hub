-- YouTube link writes: no-op scans must not touch rows, updated_at means a real
-- content/match change, observation-only metadata is tracked separately, and
-- every real confirmed-link change lands in a durable fast-lane source-change queue.

ALTER TABLE public.episode_youtube_links ADD COLUMN IF NOT EXISTS metadata_refreshed_at timestamptz;
COMMENT ON COLUMN public.episode_youtube_links.updated_at IS
  'Last real content/match change (status, title, description, score, evidence). Observation-only updates (views, caption flag) keep it unchanged.';
COMMENT ON COLUMN public.episode_youtube_links.metadata_refreshed_at IS
  'Last observation-only refresh (youtube_view_count, youtube_caption_available/checked_at). Never a text-reprocessing signal.';

-- Content-aware updated_at: only a real content/match change bumps it.
CREATE OR REPLACE FUNCTION public.tg_eyl_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.episode_id IS DISTINCT FROM OLD.episode_id
     OR NEW.podcast_id IS DISTINCT FROM OLD.podcast_id
     OR NEW.youtube_video_id IS DISTINCT FROM OLD.youtube_video_id
     OR NEW.youtube_channel_id IS DISTINCT FROM OLD.youtube_channel_id
     OR NEW.youtube_title IS DISTINCT FROM OLD.youtube_title
     OR NEW.youtube_description IS DISTINCT FROM OLD.youtube_description
     OR NEW.youtube_published_at IS DISTINCT FROM OLD.youtube_published_at
     OR NEW.youtube_duration_seconds IS DISTINCT FROM OLD.youtube_duration_seconds
     OR NEW.match_score IS DISTINCT FROM OLD.match_score
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.found_by IS DISTINCT FROM OLD.found_by
     OR NEW.validated_by IS DISTINCT FROM OLD.validated_by
     OR (NEW.validation_reason - 'youtube_caption_available') IS DISTINCT FROM (OLD.validation_reason - 'youtube_caption_available')
  THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := OLD.updated_at;
    IF NEW.youtube_view_count IS DISTINCT FROM OLD.youtube_view_count
       OR NEW.youtube_caption_available IS DISTINCT FROM OLD.youtube_caption_available
       OR NEW.youtube_caption_checked_at IS DISTINCT FROM OLD.youtube_caption_checked_at THEN
      IF NEW.metadata_refreshed_at IS NOT DISTINCT FROM OLD.metadata_refreshed_at THEN
        NEW.metadata_refreshed_at := now();
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_eyl_updated_at ON public.episode_youtube_links;
CREATE TRIGGER trg_eyl_updated_at BEFORE UPDATE ON public.episode_youtube_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_eyl_set_updated_at();

-- Durable fast-lane queue: one row per episode with a pending source change.
CREATE TABLE IF NOT EXISTS public.episode_source_change_queue (
  episode_id uuid PRIMARY KEY,
  source text NOT NULL DEFAULT 'youtube',
  reason text NOT NULL,
  priority smallint NOT NULL DEFAULT 50,
  change_seq bigint NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dead')),
  first_enqueued_at timestamptz NOT NULL DEFAULT now(),
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  leased_until timestamptz,
  last_error text
);
GRANT SELECT ON public.episode_source_change_queue TO authenticated;
GRANT ALL ON public.episode_source_change_queue TO service_role;
ALTER TABLE public.episode_source_change_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read source change queue" ON public.episode_source_change_queue;
CREATE POLICY "Admins read source change queue" ON public.episode_source_change_queue
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS episode_source_change_queue_claim_idx
  ON public.episode_source_change_queue (priority DESC, enqueued_at, episode_id) WHERE status = 'pending';

-- Enqueue only real confirmed-link changes for Hungarian podcasts; no-op and
-- observation-only writes never enqueue.
CREATE OR REPLACE FUNCTION public.tg_eyl_enqueue_source_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text;
  v_pri smallint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'confirmed' THEN RETURN NULL; END IF;
    v_reason := 'new_confirmed'; v_pri := 100;
  ELSIF NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' THEN
    v_reason := 'promoted_confirmed'; v_pri := 100;
  ELSIF OLD.status = 'confirmed' AND NEW.status IS DISTINCT FROM 'confirmed' THEN
    v_reason := 'demoted'; v_pri := 90;
  ELSIF NEW.status = 'confirmed' AND (
       NEW.youtube_description IS DISTINCT FROM OLD.youtube_description
    OR NEW.youtube_title IS DISTINCT FROM OLD.youtube_title
    OR NEW.match_score IS DISTINCT FROM OLD.match_score
    OR NEW.youtube_video_id IS DISTINCT FROM OLD.youtube_video_id
    OR NEW.episode_id IS DISTINCT FROM OLD.episode_id
    OR (NEW.validation_reason ->> 'policy') IS DISTINCT FROM (OLD.validation_reason ->> 'policy')) THEN
    v_reason := 'content_changed'; v_pri := 80;
  ELSE
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.podcasts p WHERE p.id = NEW.podcast_id AND p.language_decision = 'accept_hungarian') THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.episode_source_change_queue AS q (episode_id, source, reason, priority)
  VALUES (NEW.episode_id, 'youtube', v_reason, v_pri)
  ON CONFLICT (episode_id) DO UPDATE SET
    change_seq = q.change_seq + 1,
    reason = EXCLUDED.reason,
    priority = greatest(q.priority, EXCLUDED.priority),
    status = 'pending',
    enqueued_at = now(),
    available_at = now(),
    attempts = 0,
    last_error = NULL;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_eyl_enqueue_source_change ON public.episode_youtube_links;
CREATE TRIGGER trg_eyl_enqueue_source_change AFTER INSERT OR UPDATE ON public.episode_youtube_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_eyl_enqueue_source_change();

-- Lease-based claim (SKIP LOCKED, overlap-safe). Rows claimed 5 times without
-- an ack become 'dead' (visible, never silently dropped).
CREATE OR REPLACE FUNCTION public.claim_episode_source_changes_v1(p_limit integer DEFAULT 20, p_lease_seconds integer DEFAULT 600)
RETURNS TABLE(episode_id uuid, change_seq bigint, lease_token uuid, reason text, priority smallint, enqueued_at timestamptz, first_enqueued_at timestamptz, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  UPDATE public.episode_source_change_queue q
     SET status = 'dead', lease_token = NULL, leased_until = NULL,
         last_error = coalesce(q.last_error, 'lease_expired_after_max_attempts')
   WHERE q.status = 'pending' AND q.attempts >= 5 AND (q.leased_until IS NULL OR q.leased_until < now());
  RETURN QUERY
  WITH c AS (
    SELECT q.episode_id FROM public.episode_source_change_queue q
     WHERE q.status = 'pending' AND q.available_at <= now()
       AND (q.leased_until IS NULL OR q.leased_until < now())
     ORDER BY q.priority DESC, q.enqueued_at, q.episode_id
     LIMIT least(greatest(coalesce(p_limit, 20), 0), 60)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.episode_source_change_queue q
     SET lease_token = v_token,
         leased_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 600), 60), 3600)),
         attempts = q.attempts + 1
    FROM c WHERE q.episode_id = c.episode_id
  RETURNING q.episode_id, q.change_seq, q.lease_token, q.reason, q.priority, q.enqueued_at, q.first_enqueued_at, q.attempts;
END $$;

-- Ack: delete only rows whose change_seq is unchanged (a change that arrived
-- during processing stays queued). On error: release with backoff.
CREATE OR REPLACE FUNCTION public.ack_episode_source_changes_v1(p_lease_token uuid, p_items jsonb, p_error text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_done integer := 0;
  n_requeued integer := 0;
  n_failed integer := 0;
BEGIN
  IF p_lease_token IS NULL THEN RAISE EXCEPTION 'lease_token required'; END IF;
  IF p_error IS NULL THEN
    WITH it AS (
      SELECT x.episode_id, x.change_seq FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) AS x(episode_id uuid, change_seq bigint)
    ), del AS (
      DELETE FROM public.episode_source_change_queue q USING it
       WHERE q.episode_id = it.episode_id AND q.lease_token = p_lease_token AND q.change_seq = it.change_seq
      RETURNING 1
    ) SELECT count(*) INTO n_done FROM del;
    WITH rel AS (
      UPDATE public.episode_source_change_queue q
         SET lease_token = NULL, leased_until = NULL, available_at = now()
       WHERE q.lease_token = p_lease_token
      RETURNING 1
    ) SELECT count(*) INTO n_requeued FROM rel;
  ELSE
    WITH f AS (
      UPDATE public.episode_source_change_queue q
         SET lease_token = NULL, leased_until = NULL, last_error = left(p_error, 500),
             available_at = now() + make_interval(mins => least(60, (2 ^ least(q.attempts, 6))::integer)),
             status = CASE WHEN q.attempts >= 5 THEN 'dead' ELSE 'pending' END
       WHERE q.lease_token = p_lease_token
      RETURNING 1
    ) SELECT count(*) INTO n_failed FROM f;
  END IF;
  RETURN jsonb_build_object('done', n_done, 'requeued', n_requeued, 'failed', n_failed);
END $$;

-- Race-safe pairer write: row-locked compare, write only on real change,
-- confirmed links are sticky unless the same scan chose a different video,
-- human/manual links are never touched, episodes are updated only when the
-- winner or its score actually changes.
CREATE OR REPLACE FUNCTION public.upsert_episode_youtube_links_v1(p_rows jsonb, p_winners jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  cur public.episode_youtube_links%ROWTYPE;
  v_status text; v_conf text; v_valby text; v_found text; v_score numeric; v_reason jsonb;
  v_views_write boolean; v_cap boolean; v_content boolean;
  n_ins integer := 0; n_content integer := 0; n_meta integer := 0; n_noop integer := 0;
  n_protected integer := 0; n_sticky integer := 0; n_demoted integer := 0; n_manual_block integer := 0;
  n_ep integer := 0; n_skipped integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'rows must be a json array'; END IF;
  IF jsonb_array_length(p_rows) > 500 THEN RAISE EXCEPTION 'at most 500 rows per call'; END IF;

  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(
      episode_id uuid, podcast_id uuid, youtube_video_id text, youtube_channel_id text, youtube_title text,
      youtube_description text, youtube_published_at timestamptz, youtube_duration_seconds integer,
      youtube_caption_available boolean, youtube_view_count bigint, match_score numeric, confidence text,
      status text, found_by text, validated_by text, validation_reason jsonb, demote_allowed boolean)
  LOOP
    IF r.episode_id IS NULL OR r.podcast_id IS NULL OR coalesce(r.youtube_video_id, '') = ''
       OR r.status IS NULL OR r.status NOT IN ('confirmed', 'candidate', 'rejected') THEN
      n_skipped := n_skipped + 1; CONTINUE;
    END IF;
    v_status := r.status;
    v_conf := coalesce(r.confidence, r.status);
    v_valby := r.validated_by;
    v_found := coalesce(r.found_by, 'youtube-episode-pairer');
    v_score := r.match_score;
    v_reason := coalesce(r.validation_reason, '{}'::jsonb);

    IF v_status = 'confirmed' AND EXISTS (
      SELECT 1 FROM public.episode_youtube_links m
       WHERE m.episode_id = r.episode_id AND m.youtube_video_id <> r.youtube_video_id
         AND m.status = 'confirmed' AND (m.found_by = 'manual' OR m.validated_by = 'human')) THEN
      v_status := 'candidate'; v_conf := 'candidate'; v_valby := NULL;
      v_reason := v_reason || '{"blocked_by_manual_link": true}'::jsonb;
      n_manual_block := n_manual_block + 1;
    END IF;

    SELECT * INTO cur FROM public.episode_youtube_links l
     WHERE l.episode_id = r.episode_id AND l.youtube_video_id = r.youtube_video_id FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.episode_youtube_links(
        episode_id, podcast_id, youtube_video_id, youtube_channel_id, youtube_title, youtube_description,
        youtube_published_at, youtube_duration_seconds, youtube_view_count, youtube_caption_available,
        youtube_caption_checked_at, match_score, confidence, status, found_by, validated_by, validation_reason,
        metadata_refreshed_at)
      VALUES (
        r.episode_id, r.podcast_id, r.youtube_video_id, r.youtube_channel_id, r.youtube_title, r.youtube_description,
        r.youtube_published_at, r.youtube_duration_seconds, r.youtube_view_count, r.youtube_caption_available,
        CASE WHEN r.youtube_caption_available IS NULL THEN NULL ELSE now() END, v_score, v_conf, v_status, v_found,
        v_valby, v_reason, now())
      ON CONFLICT (episode_id, youtube_video_id) DO NOTHING;
      IF FOUND THEN n_ins := n_ins + 1; CONTINUE; END IF;
      SELECT * INTO cur FROM public.episode_youtube_links l
       WHERE l.episode_id = r.episode_id AND l.youtube_video_id = r.youtube_video_id FOR UPDATE;
      IF NOT FOUND THEN n_skipped := n_skipped + 1; CONTINUE; END IF;
    END IF;

    IF cur.found_by = 'manual' OR cur.validated_by = 'human' THEN
      n_protected := n_protected + 1; CONTINUE;
    END IF;

    IF cur.status = 'confirmed' AND v_status <> 'confirmed' THEN
      IF coalesce(r.demote_allowed, false) THEN
        n_demoted := n_demoted + 1;
      ELSE
        v_status := 'confirmed'; v_conf := cur.confidence; v_valby := cur.validated_by;
        v_score := cur.match_score; v_reason := cur.validation_reason;
        n_sticky := n_sticky + 1;
      END IF;
    END IF;

    v_content := cur.podcast_id IS DISTINCT FROM r.podcast_id
      OR cur.youtube_channel_id IS DISTINCT FROM r.youtube_channel_id
      OR cur.youtube_title IS DISTINCT FROM r.youtube_title
      OR cur.youtube_description IS DISTINCT FROM r.youtube_description
      OR cur.youtube_published_at IS DISTINCT FROM r.youtube_published_at
      OR cur.youtube_duration_seconds IS DISTINCT FROM r.youtube_duration_seconds
      OR cur.match_score IS DISTINCT FROM v_score
      OR cur.confidence IS DISTINCT FROM v_conf
      OR cur.status IS DISTINCT FROM v_status
      OR cur.found_by IS DISTINCT FROM v_found
      OR cur.validated_by IS DISTINCT FROM v_valby
      OR (cur.validation_reason - 'youtube_caption_available') IS DISTINCT FROM (v_reason - 'youtube_caption_available');
    v_views_write := r.youtube_view_count IS NOT NULL AND (
      cur.youtube_view_count IS NULL
      OR abs(r.youtube_view_count - cur.youtube_view_count) > greatest(100, cur.youtube_view_count / 10)
      OR (cur.metadata_refreshed_at IS NOT NULL AND cur.metadata_refreshed_at < now() - interval '7 days'
          AND r.youtube_view_count IS DISTINCT FROM cur.youtube_view_count));
    v_cap := r.youtube_caption_available IS NOT NULL AND r.youtube_caption_available IS DISTINCT FROM cur.youtube_caption_available;

    IF NOT v_content AND NOT v_views_write AND NOT v_cap THEN
      n_noop := n_noop + 1; CONTINUE;
    END IF;

    UPDATE public.episode_youtube_links SET
      podcast_id = r.podcast_id,
      youtube_channel_id = r.youtube_channel_id,
      youtube_title = r.youtube_title,
      youtube_description = r.youtube_description,
      youtube_published_at = r.youtube_published_at,
      youtube_duration_seconds = r.youtube_duration_seconds,
      match_score = v_score,
      confidence = v_conf,
      status = v_status,
      found_by = v_found,
      validated_by = v_valby,
      validation_reason = CASE WHEN (cur.validation_reason - 'youtube_caption_available') IS NOT DISTINCT FROM (v_reason - 'youtube_caption_available')
                               THEN cur.validation_reason ELSE v_reason END,
      youtube_view_count = CASE WHEN v_views_write THEN r.youtube_view_count ELSE cur.youtube_view_count END,
      youtube_caption_available = CASE WHEN v_cap THEN r.youtube_caption_available ELSE cur.youtube_caption_available END,
      youtube_caption_checked_at = CASE WHEN v_cap THEN now() ELSE cur.youtube_caption_checked_at END,
      metadata_refreshed_at = CASE WHEN v_views_write OR v_cap THEN now() ELSE cur.metadata_refreshed_at END
    WHERE id = cur.id;
    IF v_content THEN n_content := n_content + 1; ELSE n_meta := n_meta + 1; END IF;
  END LOOP;

  IF p_winners IS NOT NULL AND jsonb_typeof(p_winners) = 'array' AND jsonb_array_length(p_winners) > 0 THEN
    WITH w AS (
      SELECT DISTINCT ON (x.episode_id) x.episode_id, x.youtube_video_id
        FROM jsonb_to_recordset(p_winners) AS x(episode_id uuid, youtube_video_id text)
       WHERE x.episode_id IS NOT NULL AND coalesce(x.youtube_video_id, '') <> ''
    ), el AS (
      SELECT w.episode_id, l.youtube_video_id, l.match_score
        FROM w JOIN public.episode_youtube_links l
          ON l.episode_id = w.episode_id AND l.youtube_video_id = w.youtube_video_id AND l.status = 'confirmed'
    ), upd AS (
      UPDATE public.episodes e SET
        youtube_video_id = el.youtube_video_id,
        youtube_url = 'https://www.youtube.com/watch?v=' || el.youtube_video_id,
        youtube_pairing_status = 'paired',
        youtube_paired_at = CASE WHEN e.youtube_video_id IS DISTINCT FROM el.youtube_video_id OR e.youtube_paired_at IS NULL
                                 THEN now() ELSE e.youtube_paired_at END,
        youtube_match_score = el.match_score
      FROM el
      WHERE e.id = el.episode_id AND (
        e.youtube_video_id IS DISTINCT FROM el.youtube_video_id
        OR e.youtube_pairing_status IS DISTINCT FROM 'paired'
        OR e.youtube_match_score IS DISTINCT FROM el.match_score
        OR e.youtube_url IS DISTINCT FROM 'https://www.youtube.com/watch?v=' || el.youtube_video_id)
      RETURNING 1
    ) SELECT count(*) INTO n_ep FROM upd;
  END IF;

  RETURN jsonb_build_object('inserted', n_ins, 'content_updated', n_content, 'meta_only_updated', n_meta,
    'noop', n_noop, 'protected_manual', n_protected, 'sticky_confirmed', n_sticky, 'demoted', n_demoted,
    'blocked_by_manual_link', n_manual_block, 'episodes_updated', n_ep, 'skipped_invalid', n_skipped);
END $$;

REVOKE ALL ON FUNCTION public.claim_episode_source_changes_v1(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ack_episode_source_changes_v1(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_episode_youtube_links_v1(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_eyl_enqueue_source_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_episode_source_changes_v1(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ack_episode_source_changes_v1(uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_episode_youtube_links_v1(jsonb, jsonb) TO service_role;
