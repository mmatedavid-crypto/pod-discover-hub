-- 1) Spotify episode meta: updated_at moves only on real content/match changes
--    (re-syncs refresh last_synced_at only), so the best-source Spotify change
--    feed is not churned by no-op upserts.
CREATE OR REPLACE FUNCTION public.tg_episode_spotify_meta_content_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF ROW(NEW.episode_id, NEW.podcast_id, NEW.spotify_episode_id, NEW.spotify_url, NEW.duration_ms,
         NEW.release_date, NEW.release_date_precision, NEW.spotify_description, NEW.spotify_html_description,
         NEW.spotify_image_url_640, NEW.spotify_image_url_300, NEW.spotify_image_url_64, NEW.spotify_explicit,
         NEW.audio_preview_url, NEW.spotify_language, NEW.spotify_languages, NEW.is_playable, NEW.restrictions,
         NEW.match_method, NEW.match_confidence)
     IS DISTINCT FROM
     ROW(OLD.episode_id, OLD.podcast_id, OLD.spotify_episode_id, OLD.spotify_url, OLD.duration_ms,
         OLD.release_date, OLD.release_date_precision, OLD.spotify_description, OLD.spotify_html_description,
         OLD.spotify_image_url_640, OLD.spotify_image_url_300, OLD.spotify_image_url_64, OLD.spotify_explicit,
         OLD.audio_preview_url, OLD.spotify_language, OLD.spotify_languages, OLD.is_playable, OLD.restrictions,
         OLD.match_method, OLD.match_confidence) THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER trg_episode_spotify_meta_set_updated_at
  BEFORE UPDATE ON public.episode_spotify_meta
  FOR EACH ROW EXECUTE FUNCTION public.tg_episode_spotify_meta_content_updated_at();

-- 2) Staged Spotify comparison set (HU, matched, Spotify ≥300 chars longer than RSS).
--    Selection is decided per episode by the informative-content policy, not by length.
CREATE TABLE IF NOT EXISTS public.episode_best_source_spotify_queue (
  episode_id uuid PRIMARY KEY,
  spotify_meta_id uuid,
  sp_len integer,
  rss_len integer,
  enqueued_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.episode_best_source_spotify_queue TO service_role;
GRANT SELECT ON public.episode_best_source_spotify_queue TO authenticated;
ALTER TABLE public.episode_best_source_spotify_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spotify best source queue admin read" ON public.episode_best_source_spotify_queue
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.episode_best_source_spotify_queue (episode_id, spotify_meta_id, sp_len, rss_len)
SELECT s.episode_id, s.id, length(coalesce(s.spotify_description, '')), length(coalesce(e.description, ''))
FROM public.episode_spotify_meta s
JOIN public.episodes e ON e.id = s.episode_id
JOIN public.podcasts p ON p.id = e.podcast_id
WHERE p.language_decision = 'accept_hungarian'
  AND s.match_confidence >= 0.55
  AND length(coalesce(s.spotify_description, '')) >= length(coalesce(e.description, '')) + 300
ON CONFLICT (episode_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.best_source_spotify_targets_v1(p_after uuid DEFAULT NULL, p_limit integer DEFAULT 30)
RETURNS TABLE(episode_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.episode_id
  FROM public.episode_best_source_spotify_queue q
  WHERE p_after IS NULL OR q.episode_id > p_after
  ORDER BY q.episode_id
  LIMIT least(greatest(coalesce(p_limit, 30), 1), 200)
$$;
REVOKE ALL ON FUNCTION public.best_source_spotify_targets_v1(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.best_source_spotify_targets_v1(uuid, integer) TO service_role;

-- 3) Internal lexical transcript index. Stores token vectors and character
--    offsets only (no transcript text, no snippets). Service role only: no
--    anon/authenticated grants, RLS on with no policies. Transcripts stay
--    index-only (public_display=false); nothing here is ever sent to visitors.
CREATE TABLE IF NOT EXISTS public.episode_transcript_lexical_chunks (
  transcript_id uuid NOT NULL,
  chunk_idx integer NOT NULL,
  episode_id uuid NOT NULL,
  char_start integer NOT NULL,
  char_end integer NOT NULL,
  transcript_content_hash text NOT NULL,
  source_class text NOT NULL,
  rights_status text NOT NULL,
  tsv tsvector NOT NULL,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transcript_id, chunk_idx)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.episode_transcript_lexical_chunks TO service_role;
ALTER TABLE public.episode_transcript_lexical_chunks ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_etlc_tsv ON public.episode_transcript_lexical_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS idx_etlc_episode ON public.episode_transcript_lexical_chunks (episode_id);
COMMENT ON TABLE public.episode_transcript_lexical_chunks IS
  'Internal, server-only lexical index of index-only transcripts (token vectors + offsets, no text). Never exposed publicly; not identity evidence.';

-- Source class from the transcript origin; only index-only/licensed rights are indexed.
CREATE OR REPLACE FUNCTION public.transcript_source_class_v1(p_model text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_model LIKE 'rss_podcast_transcript_tag:%' THEN 'publisher_rss_transcript'
    WHEN p_model LIKE 'supadata-youtube%' THEN 'youtube_caption'
    ELSE 'other_index_only'
  END
$$;

-- Builds/refreshes the lexical chunks of ≤50 episodes (latest ok transcript each).
-- Unchanged transcripts (same content hash) are skipped; changed ones are replaced.
CREATE OR REPLACE FUNCTION public.index_transcript_lexical_v1(
  p_episode_ids uuid[],
  p_allowed_classes text[] DEFAULT ARRAY['publisher_rss_transcript', 'youtube_caption'],
  p_chunk_chars integer DEFAULT 2000,
  p_overlap integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t record;
  v_chunk integer := least(greatest(coalesce(p_chunk_chars, 2000), 500), 4000);
  v_overlap integer;
  v_step integer;
  v_indexed integer := 0;
  v_chunks integer := 0;
  v_unchanged integer := 0;
  v_skipped_class integer := 0;
  v_n integer;
BEGIN
  IF coalesce(array_length(p_episode_ids, 1), 0) > 50 THEN
    RAISE EXCEPTION 'at most 50 episodes per call';
  END IF;
  v_overlap := least(greatest(coalesce(p_overlap, 200), 50), v_chunk / 2);
  v_step := v_chunk - v_overlap;
  FOR t IN
    SELECT DISTINCT ON (tr.episode_id)
      tr.id, tr.episode_id, tr.transcript, tr.rights_status,
      public.transcript_source_class_v1(coalesce(tr.model, '')) AS cls,
      coalesce(nullif(tr.content_hash, ''), md5(tr.transcript)) AS h
    FROM public.episode_transcripts tr
    JOIN public.episodes e ON e.id = tr.episode_id
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE tr.episode_id = ANY (p_episode_ids)
      AND tr.status = 'ok'
      AND length(coalesce(tr.transcript, '')) >= 900
      AND tr.rights_status = ANY (ARRAY['rss_public_index_only', 'licensed', 'owned'])
      AND p.language_decision = 'accept_hungarian'
    ORDER BY tr.episode_id, tr.updated_at DESC NULLS LAST
  LOOP
    IF NOT (t.cls = ANY (p_allowed_classes)) THEN
      v_skipped_class := v_skipped_class + 1;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.episode_transcript_lexical_chunks c
               WHERE c.episode_id = t.episode_id AND c.transcript_id = t.id AND c.transcript_content_hash = t.h)
       AND NOT EXISTS (SELECT 1 FROM public.episode_transcript_lexical_chunks c
               WHERE c.episode_id = t.episode_id AND (c.transcript_id <> t.id OR c.transcript_content_hash <> t.h)) THEN
      v_unchanged := v_unchanged + 1;
      CONTINUE;
    END IF;
    DELETE FROM public.episode_transcript_lexical_chunks c WHERE c.episode_id = t.episode_id;
    INSERT INTO public.episode_transcript_lexical_chunks
      (transcript_id, chunk_idx, episode_id, char_start, char_end, transcript_content_hash, source_class, rights_status, tsv)
    SELECT t.id, (g.s / v_step)::integer, t.episode_id, g.s, least(length(t.transcript), g.s + v_chunk),
           t.h, t.cls, t.rights_status,
           to_tsvector('simple'::regconfig, public.unaccent(substr(t.transcript, g.s + 1, v_chunk)))
    FROM generate_series(0, greatest(length(t.transcript) - 1, 0), v_step) AS g(s);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_indexed := v_indexed + 1;
    v_chunks := v_chunks + v_n;
  END LOOP;
  RETURN jsonb_build_object('indexed_episodes', v_indexed, 'chunks', v_chunks, 'unchanged', v_unchanged, 'skipped_source_class', v_skipped_class);
END
$$;
REVOKE ALL ON FUNCTION public.index_transcript_lexical_v1(uuid[], text[], integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.index_transcript_lexical_v1(uuid[], text[], integer, integer) TO service_role;

-- Episodes whose latest ok transcript is not (or not freshly) indexed; bounded.
CREATE OR REPLACE FUNCTION public.transcript_lexical_index_targets_v1(p_limit integer DEFAULT 50)
RETURNS TABLE(episode_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT x.episode_id FROM (
    SELECT DISTINCT ON (tr.episode_id) tr.episode_id, tr.id, coalesce(nullif(tr.content_hash, ''), md5(tr.transcript)) AS h
    FROM public.episode_transcripts tr
    JOIN public.episodes e ON e.id = tr.episode_id
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE tr.status = 'ok' AND length(coalesce(tr.transcript, '')) >= 900
      AND tr.rights_status = ANY (ARRAY['rss_public_index_only', 'licensed', 'owned'])
      AND p.language_decision = 'accept_hungarian'
    ORDER BY tr.episode_id, tr.updated_at DESC NULLS LAST
  ) x
  WHERE NOT EXISTS (SELECT 1 FROM public.episode_transcript_lexical_chunks c
                    WHERE c.episode_id = x.episode_id AND c.transcript_id = x.id AND c.transcript_content_hash = x.h)
  ORDER BY x.episode_id
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 50)
$$;
REVOKE ALL ON FUNCTION public.transcript_lexical_index_targets_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transcript_lexical_index_targets_v1(integer) TO service_role;

-- Phrase tsquery: accent/case-insensitive tokens, adjacent and in order. With
-- p_prefix_last the last word may carry a Hungarian suffix ("Andrásról").
CREATE OR REPLACE FUNCTION public.lexical_phrase_tsquery_v1(p_text text, p_prefix_last boolean DEFAULT false)
RETURNS tsquery
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH t AS (
    SELECT array_remove(regexp_split_to_array(lower(public.unaccent(coalesce(p_text, ''))), '[^[:alnum:]]+'), '') AS a
  )
  SELECT CASE WHEN coalesce(array_length(a, 1), 0) = 0 THEN NULL
    ELSE to_tsquery('simple'::regconfig, array_to_string(a, ' <-> ') || CASE WHEN p_prefix_last THEN ':*' ELSE '' END)
  END
  FROM t
$$;

-- Strict phrase lookup (accent/case-insensitive, words adjacent and in order).
-- Returns episode ids and hit counts only — never text or snippets.
CREATE OR REPLACE FUNCTION public.search_transcript_lexical_v1(p_query text, p_limit integer DEFAULT 50, p_episode_ids uuid[] DEFAULT NULL, p_prefix_last boolean DEFAULT false)
RETURNS TABLE(episode_id uuid, chunk_hits integer, first_char integer, source_class text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.episode_id, count(*)::integer, min(c.char_start)::integer, min(c.source_class)
  FROM public.episode_transcript_lexical_chunks c
  WHERE length(btrim(coalesce(p_query, ''))) >= 3
    AND c.tsv @@ public.lexical_phrase_tsquery_v1(p_query, p_prefix_last)
    AND (p_episode_ids IS NULL OR c.episode_id = ANY (p_episode_ids))
  GROUP BY c.episode_id
  ORDER BY count(*) DESC, c.episode_id
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
$$;
REVOKE ALL ON FUNCTION public.search_transcript_lexical_v1(text, integer, uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_transcript_lexical_v1(text, integer, uuid[], boolean) TO service_role;

-- Read-only dry run: which existing person–episode links on these episodes have
-- the person's complete name spoken in the indexed transcript. Writes nothing;
-- a name match is text evidence only, never identity confirmation.
CREATE OR REPLACE FUNCTION public.transcript_person_evidence_dry_run_v1(p_episode_ids uuid[])
RETURNS TABLE(mention_id uuid, person_id uuid, episode_id uuid, relevance_status text, role_type text,
              mention_type text, identity_ambiguous boolean, name_tokens integer, transcript_indexed boolean, transcript_hits integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.person_id, m.episode_id, m.relevance_status, m.role_type, m.mention_type,
         coalesce(pe.identity_ambiguous, false),
         array_length(regexp_split_to_array(btrim(pe.name), '\s+'), 1),
         EXISTS (SELECT 1 FROM public.episode_transcript_lexical_chunks c WHERE c.episode_id = m.episode_id),
         (SELECT count(*)::integer FROM public.episode_transcript_lexical_chunks c
           WHERE c.episode_id = m.episode_id
             AND array_length(regexp_split_to_array(btrim(pe.name), '\s+'), 1) >= 2
             AND c.tsv @@ public.lexical_phrase_tsquery_v1(pe.name, true))
  FROM public.person_episode_mentions m
  JOIN public.people pe ON pe.id = m.person_id
  WHERE m.episode_id = ANY (p_episode_ids)
    AND coalesce(array_length(p_episode_ids, 1), 0) <= 50
$$;
REVOKE ALL ON FUNCTION public.transcript_person_evidence_dry_run_v1(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transcript_person_evidence_dry_run_v1(uuid[]) TO service_role;
