-- Durable clean-text repair queue: one row per Hungarian episode that needs
-- (or needed) clean-text repair, keyed by episode with the RSS source
-- fingerprint and repair kind. Finite, auditable statuses; lease + backoff;
-- refreshed only on a real RSS description change (trigger) or a daily
-- set-based reconciliation scan. Writes to episode_clean_text still go only
-- through apply_clean_text_repair_v1 (backup + CAS).
CREATE TABLE IF NOT EXISTS public.clean_text_repair_queue (
  episode_id uuid PRIMARY KEY,
  repair_kind text NOT NULL,
  source_fingerprint text NOT NULL,
  priority integer NOT NULL DEFAULT 50,
  status text NOT NULL DEFAULT 'pending',
  outcome text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  lease_owner text,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_reasons text[] NOT NULL DEFAULT '{}',
  last_batch_id uuid,
  published_at timestamptz,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT clean_text_repair_queue_status_chk CHECK (status IN (
    'pending','leased','done','no_substantive_source','protected','needs_review','quarantine','retry','dead'))
);
GRANT ALL ON public.clean_text_repair_queue TO service_role;
ALTER TABLE public.clean_text_repair_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read clean text repair queue" ON public.clean_text_repair_queue
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.clean_text_repair_queue TO authenticated;

CREATE INDEX IF NOT EXISTS clean_text_repair_queue_claim_idx
  ON public.clean_text_repair_queue (priority, published_at DESC NULLS LAST, episode_id)
  WHERE status IN ('pending','retry','leased');
CREATE INDEX IF NOT EXISTS clean_text_repair_queue_status_idx
  ON public.clean_text_repair_queue (status, repair_kind);
CREATE INDEX IF NOT EXISTS clean_text_repair_queue_resolved_idx
  ON public.clean_text_repair_queue (resolved_at) WHERE outcome = 'applied';

CREATE OR REPLACE FUNCTION public.clean_text_repair_fingerprint_v1(p_description text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT md5(coalesce(p_description, '')) $$;

-- Set-based classification + reconciliation (daily). Never touches episodes or
-- episode_clean_text; only the queue.
CREATE OR REPLACE FUNCTION public.clean_text_repair_queue_seed_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  n_upsert integer := 0;
  n_resolved integer := 0;
  t0 timestamptz := clock_timestamp();
BEGIN
  CREATE TEMP TABLE _ctq_cls ON COMMIT DROP AS
  SELECT x.id, x.published_at, x.fp,
    CASE
      WHEN x.k IN ('empty_substantive','empty_any','missing_rss','overcut') AND x.bs IN ('youtube','spotify') THEN 'alt_source_lane'
      WHEN x.k = 'no_source' AND x.bs IN ('youtube','spotify') THEN 'alt_source_lane'
      ELSE x.k END AS kind
  FROM (
    SELECT e.id, e.published_at, public.clean_text_repair_fingerprint_v1(e.description) AS fp, b.source_type AS bs,
      CASE
        WHEN e.clean_text_status IN ('pending','error') THEN 'runner'
        WHEN c.episode_id IS NOT NULL AND length(btrim(coalesce(c.cleaned_text,''))) = 0 AND length(coalesce(e.description,'')) > 500 THEN 'empty_substantive'
        WHEN c.episode_id IS NOT NULL AND length(btrim(coalesce(c.cleaned_text,''))) = 0 AND length(coalesce(e.description,'')) >= 40 THEN 'empty_any'
        WHEN (c.episode_id IS NULL OR e.clean_text_status = 'skipped') AND length(coalesce(e.description,'')) >= 40 THEN 'missing_rss'
        WHEN c.episode_id IS NOT NULL AND length(btrim(coalesce(c.cleaned_text,''))) > 0 AND length(coalesce(e.description,'')) >= 300
          AND length(btrim(c.cleaned_text)) < 0.2 * length(e.description) THEN 'overcut'
        WHEN coalesce(c.cleaner_method,'') LIKE '%ytdesc%' AND coalesce(b.source_type,'rss') = 'rss' THEN 'legacy_ytdesc'
        WHEN c.episode_id IS NULL OR e.clean_text_status = 'skipped' OR length(btrim(coalesce(c.cleaned_text,''))) = 0 THEN 'no_source'
        ELSE 'ok' END AS k
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id AND p.language_decision = 'accept_hungarian'
    LEFT JOIN public.episode_clean_text c ON c.episode_id = e.id
    LEFT JOIN public.episode_best_text_source b ON b.episode_id = e.id
  ) x;

  WITH src AS (
    SELECT id, published_at, fp, kind,
      CASE kind WHEN 'empty_substantive' THEN 10 WHEN 'empty_any' THEN 20 WHEN 'missing_rss' THEN 25 WHEN 'overcut' THEN 30 ELSE 90 END AS prio,
      CASE kind
        WHEN 'legacy_ytdesc' THEN 'needs_review'
        WHEN 'alt_source_lane' THEN 'protected'
        WHEN 'no_source' THEN 'no_substantive_source'
        ELSE 'pending' END AS st,
      CASE kind
        WHEN 'legacy_ytdesc' THEN 'legacy_ytdesc_separate_review'
        WHEN 'alt_source_lane' THEN 'alt_source_lane'
        WHEN 'no_source' THEN 'rss_under_40_chars'
        ELSE NULL END AS oc
    FROM _ctq_cls WHERE kind NOT IN ('ok','runner')
  ), up AS (
    INSERT INTO public.clean_text_repair_queue AS q
      (episode_id, repair_kind, source_fingerprint, priority, status, outcome, published_at, last_reasons, resolved_at)
    SELECT id, kind, fp, prio, st, oc, published_at, ARRAY['seed_v1_' || kind], CASE WHEN st = 'pending' THEN NULL ELSE now() END
    FROM src
    ON CONFLICT (episode_id) DO UPDATE SET
      repair_kind = EXCLUDED.repair_kind, source_fingerprint = EXCLUDED.source_fingerprint,
      priority = EXCLUDED.priority, status = EXCLUDED.status, outcome = EXCLUDED.outcome,
      attempts = 0, next_attempt_at = now(), lease_owner = NULL, lease_until = NULL,
      last_reasons = EXCLUDED.last_reasons, resolved_at = EXCLUDED.resolved_at, updated_at = now()
    WHERE q.status <> 'leased'
      AND (q.source_fingerprint IS DISTINCT FROM EXCLUDED.source_fingerprint OR q.repair_kind IS DISTINCT FROM EXCLUDED.repair_kind)
      -- A pending RSS-change row keeps its kind until processed.
      AND NOT (q.repair_kind = 'rss_changed' AND q.status IN ('pending','retry') AND q.source_fingerprint = EXCLUDED.source_fingerprint)
    RETURNING 1
  )
  SELECT count(*) INTO n_upsert FROM up;

  -- Episodes that are fine now (fixed by another lane, by the runner, or by a
  -- reviewed batch) are resolved; RSS-change rows are processed, not resolved.
  WITH res AS (
    UPDATE public.clean_text_repair_queue q
      SET status = 'done', outcome = 'resolved_elsewhere', lease_owner = NULL, lease_until = NULL,
          resolved_at = now(), updated_at = now()
    FROM _ctq_cls c
    WHERE c.id = q.episode_id AND c.kind = 'ok' AND q.repair_kind <> 'rss_changed'
      AND q.status IN ('pending','retry','protected','needs_review','quarantine','dead','no_substantive_source')
    RETURNING 1
  )
  SELECT count(*) INTO n_resolved FROM res;

  RETURN jsonb_build_object(
    'upserted', n_upsert, 'resolved_elsewhere', n_resolved,
    'classified', (SELECT jsonb_object_agg(kind, n) FROM (SELECT kind, count(*) n FROM _ctq_cls GROUP BY kind) s),
    'elapsed_ms', (extract(epoch FROM clock_timestamp() - t0) * 1000)::int);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_clean_text_repair_queue_v1(p_owner text, p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 600)
RETURNS TABLE(episode_id uuid, repair_kind text, source_fingerprint text, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(p_owner, '') = '' THEN RAISE EXCEPTION 'owner required'; END IF;
  RETURN QUERY
  WITH c AS (
    SELECT q.episode_id FROM public.clean_text_repair_queue q
    WHERE (q.status IN ('pending','retry') AND q.next_attempt_at <= now())
       OR (q.status = 'leased' AND q.lease_until < now())
    ORDER BY q.priority, q.published_at DESC NULLS LAST, q.episode_id
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.clean_text_repair_queue q
    SET status = 'leased', lease_owner = p_owner,
        lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 600), 60), 3600)),
        attempts = q.attempts + 1, updated_at = now()
  FROM c WHERE q.episode_id = c.episode_id
  RETURNING q.episode_id, q.repair_kind, q.source_fingerprint, q.attempts;
END;
$$;

-- Complete leased rows. Retry beyond max_attempts becomes a dead letter.
CREATE OR REPLACE FUNCTION public.complete_clean_text_repair_queue_v1(p_owner text, p_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
  n integer := 0;
  st text;
BEGIN
  IF p_results IS NULL OR jsonb_typeof(p_results) <> 'array' THEN RAISE EXCEPTION 'results must be a json array'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_results) LOOP
    st := r->>'status';
    IF st NOT IN ('done','no_substantive_source','protected','needs_review','quarantine','retry','dead') THEN
      RAISE EXCEPTION 'invalid status %', st;
    END IF;
    UPDATE public.clean_text_repair_queue q SET
      status = CASE WHEN st = 'retry' AND q.attempts >= q.max_attempts THEN 'dead' ELSE st END,
      outcome = r->>'outcome',
      last_reasons = coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(r->'reasons', '[]'::jsonb))), '{}'),
      last_batch_id = coalesce(NULLIF(r->>'batch_id','')::uuid, q.last_batch_id),
      next_attempt_at = CASE WHEN st = 'retry' THEN now() + make_interval(secs => coalesce((r->>'retry_after_seconds')::int, 600)) ELSE q.next_attempt_at END,
      resolved_at = CASE WHEN st = 'retry' THEN NULL ELSE now() END,
      lease_owner = NULL, lease_until = NULL, updated_at = now()
    WHERE q.episode_id = (r->>'episode_id')::uuid AND q.status = 'leased' AND q.lease_owner = p_owner;
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('completed', n);
END;
$$;

-- Repair targets for explicit queue ids (same columns as clean_text_repair_targets_v2,
-- no kind filter: the planner decides from the live row).
CREATE OR REPLACE FUNCTION public.clean_text_repair_queue_targets_v1(p_episode_ids uuid[])
RETURNS TABLE(
  episode_id uuid, description text, summary text, clean_text_status text,
  best_source_type text, current_source_hash text, current_cleaned_text text,
  current_cleaner_method text, has_clean_row boolean, active_backups integer,
  same_description_in_show integer, source_fingerprint text, is_hungarian boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  SELECT e.id, e.description, e.summary, e.clean_text_status, b.source_type, c.source_hash,
    c.cleaned_text, c.cleaner_method, (c.episode_id IS NOT NULL),
    (SELECT count(*)::int FROM public.episode_clean_text_repair_backups k WHERE k.episode_id = e.id AND k.rolled_back_at IS NULL),
    (SELECT count(*)::int FROM public.episodes e2 WHERE e2.podcast_id = e.podcast_id AND e2.description = e.description),
    public.clean_text_repair_fingerprint_v1(e.description),
    (p.language_decision = 'accept_hungarian')
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  LEFT JOIN public.episode_clean_text c ON c.episode_id = e.id
  LEFT JOIN public.episode_best_text_source b ON b.episode_id = e.id
  WHERE e.id = ANY(p_episode_ids)
  LIMIT 100
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
    'claimable', (SELECT count(*) FROM public.clean_text_repair_queue WHERE (status IN ('pending','retry') AND next_attempt_at <= now()) OR (status = 'leased' AND lease_until < now())),
    'open', (SELECT count(*) FROM public.clean_text_repair_queue WHERE status IN ('pending','retry','leased')),
    'applied_today', (SELECT count(*) FROM public.clean_text_repair_queue WHERE outcome = 'applied' AND resolved_at >= date_trunc('day', now())),
    'oldest_open_enqueued_at', (SELECT min(enqueued_at) FROM public.clean_text_repair_queue WHERE status IN ('pending','retry','leased')));
$$;

-- Real RSS description change on an existing Hungarian episode → queue refresh.
-- New inserts are owned by episode-clean-text-runner (status pending).
CREATE OR REPLACE FUNCTION public.tg_episodes_enqueue_clean_text_repair()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.clean_text_status IN ('pending','error') THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.podcasts p WHERE p.id = NEW.podcast_id AND p.language_decision = 'accept_hungarian') THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.clean_text_repair_queue AS q
    (episode_id, repair_kind, source_fingerprint, priority, status, published_at, last_reasons)
  VALUES (NEW.id, 'rss_changed', public.clean_text_repair_fingerprint_v1(NEW.description), 15, 'pending', NEW.published_at, ARRAY['rss_description_changed'])
  ON CONFLICT (episode_id) DO UPDATE SET
    repair_kind = 'rss_changed', source_fingerprint = EXCLUDED.source_fingerprint, priority = least(q.priority, 15),
    status = 'pending', outcome = NULL, attempts = 0, next_attempt_at = now(), lease_owner = NULL, lease_until = NULL,
    last_reasons = EXCLUDED.last_reasons, resolved_at = NULL, updated_at = now()
  WHERE q.source_fingerprint IS DISTINCT FROM EXCLUDED.source_fingerprint AND q.status <> 'leased';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_episodes_enqueue_clean_text_repair ON public.episodes;
CREATE TRIGGER trg_episodes_enqueue_clean_text_repair
  AFTER UPDATE OF description ON public.episodes
  FOR EACH ROW
  WHEN (OLD.description IS DISTINCT FROM NEW.description)
  EXECUTE FUNCTION public.tg_episodes_enqueue_clean_text_repair();

REVOKE ALL ON FUNCTION public.clean_text_repair_queue_seed_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_clean_text_repair_queue_v1(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_clean_text_repair_queue_v1(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clean_text_repair_queue_targets_v1(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clean_text_repair_queue_status_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_episodes_enqueue_clean_text_repair() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clean_text_repair_queue_seed_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_clean_text_repair_queue_v1(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_clean_text_repair_queue_v1(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.clean_text_repair_queue_targets_v1(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.clean_text_repair_queue_status_v1() TO service_role;
