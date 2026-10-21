-- One-time resolution of legacy ytdesc needs_review rows (policy legacy_ytdesc_resolve_v2).
-- Private resolution log (per-part source attribution, validated RSS-only units),
-- capped one-off AI review ledger with atomic reservation, Spotify match fields
-- for corroboration, and a fail-closed public reader: legacy YouTube-derived
-- text is public as "youtube" only when attributed to a verified link
-- (source_type = 'youtube'); merged / corroborated / unverified text is internal.

CREATE TABLE public.clean_text_legacy_resolutions (
  episode_id uuid NOT NULL,
  policy_version text NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL,
  outcome text NOT NULL,
  verdict text,
  write_kind text NOT NULL DEFAULT 'none',
  batch_id uuid,
  parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  rss_only_units jsonb NOT NULL DEFAULT '[]'::jsonb,
  dropped_units jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasons text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (episode_id, policy_version)
);
GRANT SELECT ON public.clean_text_legacy_resolutions TO authenticated;
GRANT ALL ON public.clean_text_legacy_resolutions TO service_role;
ALTER TABLE public.clean_text_legacy_resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read legacy resolutions" ON public.clean_text_legacy_resolutions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE public.clean_text_legacy_ai_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL,
  fingerprint text NOT NULL,
  prompt_version text NOT NULL,
  model text NOT NULL,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','completed','failed')),
  reserved_usd numeric NOT NULL CHECK (reserved_usd >= 0),
  actual_usd numeric,
  input_tokens integer,
  output_tokens integer,
  decision jsonb,
  validation jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (episode_id, fingerprint, prompt_version)
);
GRANT SELECT ON public.clean_text_legacy_ai_reviews TO authenticated;
GRANT ALL ON public.clean_text_legacy_ai_reviews TO service_role;
ALTER TABLE public.clean_text_legacy_ai_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read legacy ai reviews" ON public.clean_text_legacy_ai_reviews
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.app_settings(key, value) VALUES ('clean_text_legacy_ai_review_controls', jsonb_build_object(
  'enabled', false, 'total_cap_usd', 2, 'daily_cap_usd', 1, 'model', 'gpt-6-sol', 'max_items_per_call', 50,
  'note', 'One-off legacy ytdesc identity review. Owner cap: $2 total, $1/day. Disabled after the run; no cron.'))
ON CONFLICT (key) DO NOTHING;

-- Atomic reservation: serialises on the control row, fail-closed on caps / disabled.
CREATE OR REPLACE FUNCTION public.reserve_clean_text_legacy_ai_review_v1(p_model text, p_prompt_version text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ctrl jsonb; it jsonb; total numeric; today numeric; want numeric := 0; out jsonb := '[]'::jsonb; rid uuid; skipped integer := 0;
BEGIN
  SELECT value INTO ctrl FROM public.app_settings WHERE key = 'clean_text_legacy_ai_review_controls' FOR UPDATE;
  IF ctrl IS NULL OR coalesce((ctrl->>'enabled')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > least(coalesce((ctrl->>'max_items_per_call')::int, 50), 50) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many_items');
  END IF;
  SELECT coalesce(sum(CASE WHEN status = 'reserved' THEN reserved_usd ELSE coalesce(actual_usd, reserved_usd) END), 0) INTO total FROM public.clean_text_legacy_ai_reviews;
  SELECT coalesce(sum(CASE WHEN status = 'reserved' THEN reserved_usd ELSE coalesce(actual_usd, reserved_usd) END), 0) INTO today FROM public.clean_text_legacy_ai_reviews WHERE created_at >= date_trunc('day', now());
  SELECT coalesce(sum((x->>'reserve_usd')::numeric), 0) INTO want FROM jsonb_array_elements(p_items) x;
  IF want <= 0 OR total + want > coalesce((ctrl->>'total_cap_usd')::numeric, 0) OR today + want > coalesce((ctrl->>'daily_cap_usd')::numeric, 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cap', 'spent_or_reserved_total', total, 'spent_or_reserved_today', today, 'requested', want);
  END IF;
  FOR it IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.clean_text_legacy_ai_reviews(episode_id, fingerprint, prompt_version, model, reserved_usd)
    VALUES ((it->>'episode_id')::uuid, it->>'fingerprint', p_prompt_version, p_model, (it->>'reserve_usd')::numeric)
    ON CONFLICT (episode_id, fingerprint, prompt_version) DO NOTHING RETURNING id INTO rid;
    IF rid IS NULL THEN skipped := skipped + 1;
    ELSE out := out || jsonb_build_array(jsonb_build_object('id', rid, 'episode_id', it->>'episode_id')); END IF;
    rid := NULL;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'reserved', out, 'skipped_existing', skipped, 'total_before', total, 'today_before', today);
END; $$;

CREATE OR REPLACE FUNCTION public.settle_clean_text_legacy_ai_review_v1(p_id uuid, p_status text, p_actual_usd numeric, p_input_tokens integer, p_output_tokens integer, p_decision jsonb, p_validation jsonb, p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('completed','failed') THEN RAISE EXCEPTION 'invalid status %', p_status; END IF;
  UPDATE public.clean_text_legacy_ai_reviews SET status = p_status,
    actual_usd = greatest(coalesce(p_actual_usd, reserved_usd), 0), input_tokens = p_input_tokens, output_tokens = p_output_tokens,
    decision = p_decision, validation = p_validation, error = left(p_error, 300), settled_at = now()
  WHERE id = p_id AND status = 'reserved';
  RETURN FOUND;
END; $$;

REVOKE ALL ON FUNCTION public.reserve_clean_text_legacy_ai_review_v1(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_clean_text_legacy_ai_review_v1(uuid, text, numeric, integer, integer, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_clean_text_legacy_ai_review_v1(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_clean_text_legacy_ai_review_v1(uuid, text, numeric, integer, integer, jsonb, jsonb, text) TO service_role;

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
        SELECT m.match_confidence, m.match_method, m.release_date, m.raw->>'name' AS name, m.spotify_description, m.spotify_html_description
        FROM public.episode_spotify_meta m WHERE m.episode_id = base.id ORDER BY m.match_confidence DESC NULLS LAST LIMIT 1) s)
  )), '[]'::jsonb) FROM base;
$$;

REVOKE ALL ON FUNCTION public.clean_text_repair_queue_legacy_inputs_v1(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clean_text_repair_queue_legacy_inputs_v1(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.get_episode_public_clean_description_v2(p_episode_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH allowed AS (
    SELECT coalesce((SELECT value->'allowed_sources' FROM public.app_settings WHERE key = 'public_clean_text_display'), '[]'::jsonb) AS srcs
  ),
  c AS (
    SELECT ct.cleaned_text, e.youtube_url, e.youtube_video_id, e.spotify_url, e.id AS episode_id,
      CASE
        WHEN ct.cleaner_method LIKE '%transcript%' OR coalesce(ct.source_type, '') = 'transcript' THEN 'transcript'
        WHEN ct.cleaner_method LIKE '%multisrc%' OR coalesce(ct.source_type, '') IN ('multi_source', 'youtube_corroborated') THEN 'internal'
        -- Legacy YouTube-description text: public as YouTube only with verified attribution.
        WHEN ct.cleaner_method LIKE '%ytdesc%' THEN CASE WHEN ct.source_type = 'youtube' THEN 'youtube' ELSE 'unverified_youtube' END
        WHEN ct.cleaner_method LIKE '%youtube%' THEN 'youtube'
        WHEN ct.cleaner_method LIKE '%article%' THEN 'article'
        WHEN ct.cleaner_method LIKE '%spotify%' THEN 'spotify'
        ELSE coalesce(nullif(ct.source_type, ''), 'rss')
      END AS src
    FROM public.episode_clean_text ct
    JOIN public.episodes e ON e.id = ct.episode_id
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE ct.episode_id = p_episode_id
      AND p.language_decision = 'accept_hungarian'
      AND e.clean_text_status = 'done'
      AND ct.quality_status IN ('valid', 'valid_short')
      AND ct.cleaner_method LIKE 'deterministic_v4%'
      AND ct.cleaner_method NOT LIKE '%ai_trim%'
      AND length(coalesce(ct.cleaned_text, '')) >= 40
  )
  SELECT jsonb_build_object(
    'text', c.cleaned_text,
    'source', c.src,
    'source_url', CASE
      WHEN c.src = 'youtube' THEN coalesce(nullif(c.youtube_url, ''),
        CASE WHEN c.youtube_video_id IS NOT NULL THEN 'https://www.youtube.com/watch?v=' || c.youtube_video_id END)
      WHEN c.src = 'spotify' THEN coalesce(nullif(c.spotify_url, ''),
        (SELECT 'https://open.spotify.com/episode/' || m.spotify_episode_id FROM public.episode_spotify_meta m
          WHERE m.episode_id = c.episode_id AND m.spotify_episode_id IS NOT NULL LIMIT 1))
      ELSE NULL END)
  FROM c, allowed
  WHERE c.src NOT IN ('transcript', 'internal', 'unverified_youtube') AND allowed.srcs ? c.src
$function$;

REVOKE ALL ON FUNCTION public.get_episode_public_clean_description_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_episode_public_clean_description_v2(uuid) TO anon, authenticated, service_role;