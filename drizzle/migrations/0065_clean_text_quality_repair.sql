-- Clean-text quality gate, quarantine, reversible repair batches and
-- index-friendly change feeds for best-text-source selection.

-- 1) Quality metadata on live clean text (nullable; existing rows untouched).
ALTER TABLE public.episode_clean_text
  ADD COLUMN IF NOT EXISTS quality_status text,
  ADD COLUMN IF NOT EXISTS quality_reasons text[],
  ADD COLUMN IF NOT EXISTS quality_version text,
  ADD COLUMN IF NOT EXISTS source_type text;

-- 2) Re-clean bookkeeping on best-source rows (nullable).
ALTER TABLE public.episode_best_text_source
  ADD COLUMN IF NOT EXISTS source_fingerprint text,
  ADD COLUMN IF NOT EXISTS reclean_status text,
  ADD COLUMN IF NOT EXISTS reclean_marked_at timestamptz;
CREATE INDEX IF NOT EXISTS episode_best_text_source_reclean_idx
  ON public.episode_best_text_source (reclean_marked_at, episode_id)
  WHERE reclean_status = 'pending';

-- 3) Quarantine for outputs that failed validation and had no good prior text.
CREATE TABLE IF NOT EXISTS public.episode_clean_text_quarantine (
  episode_id uuid PRIMARY KEY,
  source_hash text,
  source_type text,
  reasons text[] NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 1,
  raw_len integer,
  rescue_len integer,
  cleaner_method text,
  kept_prior boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.episode_clean_text_quarantine TO service_role;
GRANT SELECT ON public.episode_clean_text_quarantine TO authenticated;
ALTER TABLE public.episode_clean_text_quarantine ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clean text quarantine admin read" ON public.episode_clean_text_quarantine
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE INDEX IF NOT EXISTS episode_clean_text_quarantine_open_idx
  ON public.episode_clean_text_quarantine (last_seen_at DESC) WHERE resolved_at IS NULL;

-- 4) Backups for every applied repair item, so a batch can be rolled back.
CREATE TABLE IF NOT EXISTS public.episode_clean_text_repair_backups (
  id bigserial PRIMARY KEY,
  batch_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  old_row jsonb,
  old_clean_text_status text,
  new_source_hash text NOT NULL,
  new_cleaned_sha256 text NOT NULL,
  new_cleaner_method text NOT NULL,
  new_len integer NOT NULL,
  reasons text[] NOT NULL DEFAULT '{}',
  downstream_invalidation text NOT NULL DEFAULT 'pending',
  applied_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  rollback_result text,
  UNIQUE (batch_id, episode_id)
);
GRANT SELECT, INSERT, UPDATE ON public.episode_clean_text_repair_backups TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.episode_clean_text_repair_backups_id_seq TO service_role;
GRANT SELECT ON public.episode_clean_text_repair_backups TO authenticated;
ALTER TABLE public.episode_clean_text_repair_backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clean text repair backups admin read" ON public.episode_clean_text_repair_backups
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE INDEX IF NOT EXISTS episode_clean_text_repair_backups_episode_idx
  ON public.episode_clean_text_repair_backups (episode_id, applied_at DESC);

-- 5) Keyset change-feed indexes for the best-source runner.
CREATE INDEX IF NOT EXISTS idx_episode_transcripts_ok_updated
  ON public.episode_transcripts (updated_at, id) WHERE status = 'ok';
CREATE INDEX IF NOT EXISTS episode_youtube_links_confirmed_updated_idx
  ON public.episode_youtube_links (updated_at, id) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS episode_spotify_meta_updated_idx
  ON public.episode_spotify_meta (updated_at, id);

-- 6) Apply a bounded, compare-and-swap repair batch with full backup.
CREATE OR REPLACE FUNCTION public.apply_clean_text_repair_v1(p_batch_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it jsonb;
  ep uuid;
  cur public.episode_clean_text%ROWTYPE;
  has_cur boolean;
  prev_status text;
  new_text text;
  cur_sha text;
  n_applied integer := 0;
  n_conflict integer := 0;
  n_invalid integer := 0;
  conflicts jsonb := '[]'::jsonb;
BEGIN
  IF p_batch_id IS NULL THEN RAISE EXCEPTION 'batch_id required'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'items must be a json array'; END IF;
  IF jsonb_array_length(p_items) > 100 THEN RAISE EXCEPTION 'at most 100 items per repair batch'; END IF;
  IF EXISTS (SELECT 1 FROM public.episode_clean_text_repair_backups WHERE batch_id = p_batch_id) THEN
    RAISE EXCEPTION 'batch % already applied', p_batch_id;
  END IF;

  FOR it IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    ep := NULLIF(it->>'episode_id', '')::uuid;
    new_text := btrim(coalesce(it->>'cleaned_text', ''));
    IF ep IS NULL OR length(new_text) < 40 OR coalesce(it->>'source_hash', '') = ''
       OR coalesce(it->>'cleaner_method', '') NOT LIKE 'deterministic_v4%'
       OR new_text ~* 'https?://' THEN
      n_invalid := n_invalid + 1;
      CONTINUE;
    END IF;

    SELECT * INTO cur FROM public.episode_clean_text WHERE episode_id = ep FOR UPDATE;
    has_cur := FOUND;
    SELECT clean_text_status INTO prev_status FROM public.episodes WHERE id = ep FOR UPDATE;
    IF NOT FOUND THEN n_invalid := n_invalid + 1; CONTINUE; END IF;
    cur_sha := CASE WHEN has_cur THEN encode(sha256(convert_to(coalesce(cur.cleaned_text, ''), 'UTF8')), 'hex') ELSE NULL END;

    IF (it->>'expected_cleaned_sha256') IS DISTINCT FROM cur_sha
       OR (it->>'expected_source_hash') IS DISTINCT FROM (CASE WHEN has_cur THEN cur.source_hash ELSE NULL END) THEN
      n_conflict := n_conflict + 1;
      conflicts := conflicts || jsonb_build_array(ep);
      CONTINUE;
    END IF;

    INSERT INTO public.episode_clean_text_repair_backups(
      batch_id, episode_id, old_row, old_clean_text_status, new_source_hash, new_cleaned_sha256,
      new_cleaner_method, new_len, reasons)
    VALUES (
      p_batch_id, ep, CASE WHEN has_cur THEN to_jsonb(cur) ELSE NULL END, prev_status, it->>'source_hash',
      encode(sha256(convert_to(new_text, 'UTF8')), 'hex'), it->>'cleaner_method', length(new_text),
      coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(it->'quality_reasons', '[]'::jsonb))), '{}'));

    INSERT INTO public.episode_clean_text(
      episode_id, source_hash, cleaned_text, removed_categories, cleaner_method,
      quality_status, quality_reasons, quality_version, source_type, updated_at)
    VALUES (
      ep, it->>'source_hash', new_text,
      coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(it->'removed_categories', '[]'::jsonb))), '{}'),
      it->>'cleaner_method', it->>'quality_status',
      coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(it->'quality_reasons', '[]'::jsonb))), '{}'),
      it->>'quality_version', it->>'source_type', now())
    ON CONFLICT (episode_id) DO UPDATE SET
      source_hash = EXCLUDED.source_hash,
      cleaned_text = EXCLUDED.cleaned_text,
      removed_categories = EXCLUDED.removed_categories,
      cleaner_method = EXCLUDED.cleaner_method,
      quality_status = EXCLUDED.quality_status,
      quality_reasons = EXCLUDED.quality_reasons,
      quality_version = EXCLUDED.quality_version,
      source_type = EXCLUDED.source_type,
      updated_at = now();

    UPDATE public.episodes SET clean_text_status = 'done' WHERE id = ep;
    UPDATE public.episode_clean_text_quarantine SET resolved_at = now() WHERE episode_id = ep AND resolved_at IS NULL;
    n_applied := n_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('batch_id', p_batch_id, 'applied', n_applied, 'conflicts', n_conflict,
    'invalid', n_invalid, 'conflict_episode_ids', conflicts);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_clean_text_repair_v1(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_clean_text_repair_v1(uuid, jsonb) TO service_role;

-- 7) Roll back a batch; never clobbers rows rewritten after the repair.
CREATE OR REPLACE FUNCTION public.rollback_clean_text_repair_v1(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.episode_clean_text_repair_backups%ROWTYPE;
  cur public.episode_clean_text%ROWTYPE;
  restored public.episode_clean_text%ROWTYPE;
  n_restored integer := 0;
  n_deleted integer := 0;
  n_skipped integer := 0;
BEGIN
  IF p_batch_id IS NULL THEN RAISE EXCEPTION 'batch_id required'; END IF;
  FOR b IN SELECT * FROM public.episode_clean_text_repair_backups
           WHERE batch_id = p_batch_id AND rolled_back_at IS NULL FOR UPDATE LOOP
    SELECT * INTO cur FROM public.episode_clean_text WHERE episode_id = b.episode_id FOR UPDATE;
    IF NOT FOUND OR cur.source_hash IS DISTINCT FROM b.new_source_hash
       OR encode(sha256(convert_to(coalesce(cur.cleaned_text, ''), 'UTF8')), 'hex') <> b.new_cleaned_sha256 THEN
      UPDATE public.episode_clean_text_repair_backups
        SET rolled_back_at = now(), rollback_result = 'skipped_changed_after_repair' WHERE id = b.id;
      n_skipped := n_skipped + 1;
      CONTINUE;
    END IF;
    IF b.old_row IS NULL THEN
      DELETE FROM public.episode_clean_text WHERE episode_id = b.episode_id;
      n_deleted := n_deleted + 1;
    ELSE
      restored := jsonb_populate_record(NULL::public.episode_clean_text, b.old_row);
      UPDATE public.episode_clean_text SET
        source_hash = restored.source_hash,
        cleaned_text = restored.cleaned_text,
        removed_categories = restored.removed_categories,
        cleaner_method = restored.cleaner_method,
        model = restored.model,
        cost_usd = restored.cost_usd,
        quality_status = restored.quality_status,
        quality_reasons = restored.quality_reasons,
        quality_version = restored.quality_version,
        source_type = restored.source_type,
        updated_at = restored.updated_at
      WHERE episode_id = b.episode_id;
      n_restored := n_restored + 1;
    END IF;
    UPDATE public.episodes SET clean_text_status = b.old_clean_text_status
      WHERE id = b.episode_id AND b.old_clean_text_status IS NOT NULL;
    UPDATE public.episode_clean_text_repair_backups
      SET rolled_back_at = now(), rollback_result = 'restored' WHERE id = b.id;
  END LOOP;
  RETURN jsonb_build_object('batch_id', p_batch_id, 'restored', n_restored, 'deleted', n_deleted, 'skipped', n_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.rollback_clean_text_repair_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_clean_text_repair_v1(uuid) TO service_role;

-- 8) Bounded read-only repair target selection (admin/service only).
CREATE OR REPLACE FUNCTION public.clean_text_repair_targets_v1(p_kind text, p_limit integer DEFAULT 50)
RETURNS TABLE(
  episode_id uuid, description text, summary text, clean_text_status text,
  best_source_type text, best_raw_text text, best_evidence jsonb,
  current_source_hash text, current_cleaned_text text, current_cleaner_method text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT e.id, e.description, e.summary, e.clean_text_status,
    b.source_type, b.raw_text, b.evidence,
    c.source_hash, c.cleaned_text, c.cleaner_method
  FROM public.episode_clean_text c
  JOIN public.episodes e ON e.id = c.episode_id
  JOIN public.podcasts p ON p.id = e.podcast_id AND p.language_decision = 'accept_hungarian'
  LEFT JOIN public.episode_best_text_source b ON b.episode_id = c.episode_id
  WHERE CASE p_kind
    WHEN 'empty_substantive' THEN coalesce(btrim(c.cleaned_text), '') = '' AND length(coalesce(e.description, '')) > 500
    WHEN 'empty_any' THEN coalesce(btrim(c.cleaned_text), '') = '' AND length(coalesce(e.description, '')) >= 40
    WHEN 'short_from_long' THEN length(btrim(coalesce(c.cleaned_text, ''))) BETWEEN 1 AND 99 AND length(coalesce(e.description, '')) >= 500
    ELSE false END
  ORDER BY e.published_at DESC NULLS LAST, e.id
  LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200)
$$;
REVOKE ALL ON FUNCTION public.clean_text_repair_targets_v1(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clean_text_repair_targets_v1(text, integer) TO service_role;

-- 9) Read-only quality/backlog snapshot.
CREATE OR REPLACE FUNCTION public.clean_text_quality_audit_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  SELECT jsonb_build_object(
    'checked_at', now(),
    'status_counts', (SELECT jsonb_object_agg(coalesce(s, 'null'), n) FROM (
        SELECT e.clean_text_status s, count(*) n FROM public.episodes e
        JOIN public.podcasts p ON p.id = e.podcast_id AND p.language_decision = 'accept_hungarian' GROUP BY 1) x),
    'clean_rows', (SELECT count(*) FROM public.episode_clean_text),
    'empty_clean', (SELECT count(*) FROM public.episode_clean_text WHERE coalesce(btrim(cleaned_text), '') = ''),
    'empty_with_long_description', (SELECT count(*) FROM public.episode_clean_text c JOIN public.episodes e ON e.id = c.episode_id
        WHERE coalesce(btrim(c.cleaned_text), '') = '' AND length(coalesce(e.description, '')) > 500),
    'short_from_long_description', (SELECT count(*) FROM public.episode_clean_text c JOIN public.episodes e ON e.id = c.episode_id
        WHERE length(btrim(coalesce(c.cleaned_text, ''))) BETWEEN 1 AND 99 AND length(coalesce(e.description, '')) >= 500),
    'quality_status_counts', (SELECT jsonb_object_agg(coalesce(quality_status, 'unchecked'), n) FROM (
        SELECT quality_status, count(*) n FROM public.episode_clean_text GROUP BY 1) q),
    'best_source_counts', (SELECT jsonb_object_agg(source_type, n) FROM (
        SELECT source_type, count(*) n FROM public.episode_best_text_source GROUP BY 1) b),
    'best_source_reclean_pending', (SELECT count(*) FROM public.episode_best_text_source WHERE reclean_status = 'pending'),
    'transcripts_ok_900', (SELECT count(*) FROM public.episode_transcripts WHERE status = 'ok' AND length(transcript) >= 900),
    'quarantine_open', (SELECT count(*) FROM public.episode_clean_text_quarantine WHERE resolved_at IS NULL),
    'repair_batches', (SELECT count(DISTINCT batch_id) FROM public.episode_clean_text_repair_backups),
    'repair_items_active', (SELECT count(*) FROM public.episode_clean_text_repair_backups WHERE rolled_back_at IS NULL)
  )
$$;
REVOKE ALL ON FUNCTION public.clean_text_quality_audit_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clean_text_quality_audit_v1() TO service_role;