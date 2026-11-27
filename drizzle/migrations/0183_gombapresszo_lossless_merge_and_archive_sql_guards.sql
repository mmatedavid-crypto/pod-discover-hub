-- 1. Audited reversible episode-reassignment table for lossless duplicate-show consolidation
CREATE TABLE IF NOT EXISTS public.episode_podcast_reassignments (
  episode_id uuid PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
  from_podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  to_podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  from_podcast_slug text NOT NULL,
  to_podcast_slug text NOT NULL,
  episode_slug text NOT NULL,
  group_key text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reverted')),
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT episode_podcast_reassignments_diff_podcast CHECK (from_podcast_id <> to_podcast_id)
);

CREATE INDEX IF NOT EXISTS idx_episode_podcast_reassignments_from_slug
  ON public.episode_podcast_reassignments (from_podcast_slug, episode_slug)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_episode_podcast_reassignments_from_pod
  ON public.episode_podcast_reassignments (from_podcast_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_episode_podcast_reassignments_to_pod
  ON public.episode_podcast_reassignments (to_podcast_id)
  WHERE status = 'active';

GRANT SELECT ON public.episode_podcast_reassignments TO anon, authenticated;
GRANT ALL ON public.episode_podcast_reassignments TO service_role;

ALTER TABLE public.episode_podcast_reassignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active episode podcast reassignments" ON public.episode_podcast_reassignments;
CREATE POLICY "Public can read active episode podcast reassignments"
  ON public.episode_podcast_reassignments
  FOR SELECT
  TO anon, authenticated
  USING (status = 'active');

-- 2. Transactional lossless duplicate-show merge RPC (maps overlap + reassigns unique old-only episodes with same IDs)
CREATE OR REPLACE FUNCTION public.apply_podcast_lossless_merge_v1(
  p_alias_podcast_id uuid,
  p_canonical_podcast_id uuid,
  p_group_key text,
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_allow_audio_fallback boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_alias public.podcasts%ROWTYPE;
  v_canon public.podcasts%ROWTYPE;
  v_base jsonb;
  v_slug_collisions int := 0;
  v_guid_collisions int := 0;
  v_reassigned_ids uuid[];
  v_reassigned_count int := 0;
  v_canon_total int := 0;
  v_remaining_unmatched int := 0;
BEGIN
  IF p_alias_podcast_id = p_canonical_podcast_id THEN
    RAISE EXCEPTION 'alias and canonical podcast must differ';
  END IF;

  SELECT * INTO v_alias FROM public.podcasts WHERE id = p_alias_podcast_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'alias podcast % not found', p_alias_podcast_id; END IF;

  SELECT * INTO v_canon FROM public.podcasts WHERE id = p_canonical_podcast_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'canonical podcast % not found', p_canonical_podcast_id; END IF;

  -- First establish canonical show mapping + map all overlapping episodes (exact GUID / optional audio_url)
  v_base := public.apply_podcast_canonical_mapping_v1(
    p_alias_podcast_id,
    p_canonical_podcast_id,
    p_group_key,
    p_evidence,
    p_allow_audio_fallback
  );

  -- Collect remaining unique old-only episodes on the alias podcast
  SELECT COALESCE(array_agg(ea.id ORDER BY ea.published_at ASC NULLS LAST, ea.id ASC), '{}'::uuid[])
  INTO v_reassigned_ids
  FROM public.episodes ea
  WHERE ea.podcast_id = v_alias.id
    AND NOT EXISTS (
      SELECT 1 FROM public.episode_canonical_mappings em
      WHERE em.alias_episode_id = ea.id AND em.status = 'active'
    );

  v_reassigned_count := COALESCE(array_length(v_reassigned_ids, 1), 0);

  IF v_reassigned_count > 0 THEN
    -- Fail-closed collision checks before reassigning any episode ID
    SELECT COUNT(*) INTO v_slug_collisions
    FROM public.episodes ea
    JOIN public.episodes ec
      ON ec.podcast_id = v_canon.id
     AND ec.slug = ea.slug
    WHERE ea.id = ANY(v_reassigned_ids);

    IF v_slug_collisions > 0 THEN
      RAISE EXCEPTION 'Cannot losslessly merge % into %: % slug collision(s) detected',
        v_alias.slug, v_canon.slug, v_slug_collisions;
    END IF;

    SELECT COUNT(*) INTO v_guid_collisions
    FROM public.episodes ea
    JOIN public.episodes ec
      ON ec.podcast_id = v_canon.id
     AND ea.guid IS NOT NULL AND btrim(ea.guid) <> ''
     AND ec.guid IS NOT NULL AND btrim(ec.guid) = btrim(ea.guid)
    WHERE ea.id = ANY(v_reassigned_ids);

    IF v_guid_collisions > 0 THEN
      RAISE EXCEPTION 'Cannot losslessly merge % into %: % unmapped GUID collision(s) detected',
        v_alias.slug, v_canon.slug, v_guid_collisions;
    END IF;

    -- Record reversible per-episode audit rows before mutating podcast_id
    INSERT INTO public.episode_podcast_reassignments (
      episode_id, from_podcast_id, to_podcast_id,
      from_podcast_slug, to_podcast_slug, episode_slug,
      group_key, status, before_state, applied_at, reverted_at
    )
    SELECT
      ea.id,
      v_alias.id,
      v_canon.id,
      v_alias.slug,
      v_canon.slug,
      ea.slug,
      p_group_key,
      'active',
      jsonb_build_object(
        'original_podcast_id', ea.podcast_id,
        'original_slug', ea.slug,
        'guid', ea.guid,
        'published_at', ea.published_at
      ),
      now(),
      NULL
    FROM public.episodes ea
    WHERE ea.id = ANY(v_reassigned_ids)
    ON CONFLICT (episode_id) DO UPDATE SET
      from_podcast_id = EXCLUDED.from_podcast_id,
      to_podcast_id = EXCLUDED.to_podcast_id,
      from_podcast_slug = EXCLUDED.from_podcast_slug,
      to_podcast_slug = EXCLUDED.to_podcast_slug,
      episode_slug = EXCLUDED.episode_slug,
      group_key = EXCLUDED.group_key,
      status = 'active',
      before_state = EXCLUDED.before_state,
      applied_at = now(),
      reverted_at = NULL,
      updated_at = now();

    -- Move episodes onto canonical podcast preserving exact episode IDs, slugs, and all FKs
    UPDATE public.episodes
    SET podcast_id = v_canon.id
    WHERE id = ANY(v_reassigned_ids)
      AND podcast_id = v_alias.id;

    -- Keep denormalized podcast_id consistent across child tables (zero deletions)
    UPDATE public.episode_cards
    SET podcast_id = v_canon.id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_alias.id;

    UPDATE public.episode_chunks
    SET podcast_id = v_canon.id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_alias.id;

    UPDATE public.episode_embeddings
    SET podcast_id = v_canon.id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_alias.id;

    UPDATE public.episode_organization_map
    SET podcast_id = v_canon.id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_alias.id;

    UPDATE public.episode_spotify_meta
    SET podcast_id = v_canon.id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_alias.id;

    UPDATE public.episode_best_text_source
    SET podcast_id = v_canon.id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_alias.id;

    UPDATE public.episode_transcripts
    SET podcast_id = v_canon.id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_alias.id;

    UPDATE public.episode_article_candidates
    SET podcast_id = v_canon.id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_alias.id;

    UPDATE public.episode_youtube_links
    SET podcast_id = v_canon.id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_alias.id;

    UPDATE public.person_episode_mentions
    SET podcast_id = v_canon.id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_alias.id;

    UPDATE public.person_external_sources
    SET podcast_id = v_canon.id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_alias.id;

    UPDATE public.audio_source_repair_queue
    SET podcast_id = v_canon.id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_alias.id;

    UPDATE public.youtube_transcript_attempts
    SET podcast_id = v_canon.id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_alias.id;
  END IF;

  SELECT COUNT(*) INTO v_canon_total
  FROM public.episodes
  WHERE podcast_id = v_canon.id;

  SELECT COUNT(*) INTO v_remaining_unmatched
  FROM public.episodes ea
  WHERE ea.podcast_id = v_alias.id
    AND NOT EXISTS (
      SELECT 1 FROM public.episode_canonical_mappings em
      WHERE em.alias_episode_id = ea.id AND em.status = 'active'
    );

  RETURN v_base || jsonb_build_object(
    'reassigned_unique_episodes', v_reassigned_count,
    'canonical_total_episodes', v_canon_total,
    'unmatched_alias_episodes', v_remaining_unmatched
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_podcast_lossless_merge_v1(uuid, uuid, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_podcast_lossless_merge_v1(uuid, uuid, text, jsonb, boolean) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    REVOKE ALL ON FUNCTION public.apply_podcast_lossless_merge_v1(uuid, uuid, text, jsonb, boolean) FROM readonly_codex;
  END IF;
END $$;

-- 3. Extend revert_podcast_canonical_mapping_v1 to also revert reassigned unique episodes cleanly
CREATE OR REPLACE FUNCTION public.revert_podcast_canonical_mapping_v1(p_alias_podcast_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_map public.podcast_canonical_mappings%ROWTYPE;
  v_ep_reverted int := 0;
  v_reassigned_ids uuid[];
  v_reassigned_reverted int := 0;
BEGIN
  SELECT * INTO v_map
  FROM public.podcast_canonical_mappings
  WHERE alias_podcast_id = p_alias_podcast_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_active_mapping');
  END IF;

  -- Restore any losslessly reassigned unique episodes back to their original podcast_id
  SELECT COALESCE(array_agg(r.episode_id), '{}'::uuid[])
  INTO v_reassigned_ids
  FROM public.episode_podcast_reassignments r
  WHERE r.from_podcast_id = p_alias_podcast_id
    AND r.status = 'active';

  v_reassigned_reverted := COALESCE(array_length(v_reassigned_ids, 1), 0);

  IF v_reassigned_reverted > 0 THEN
    UPDATE public.episodes
    SET podcast_id = v_map.alias_podcast_id
    WHERE id = ANY(v_reassigned_ids)
      AND podcast_id = v_map.canonical_podcast_id;

    UPDATE public.episode_cards
    SET podcast_id = v_map.alias_podcast_id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_map.canonical_podcast_id;

    UPDATE public.episode_chunks
    SET podcast_id = v_map.alias_podcast_id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_map.canonical_podcast_id;

    UPDATE public.episode_embeddings
    SET podcast_id = v_map.alias_podcast_id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_map.canonical_podcast_id;

    UPDATE public.episode_organization_map
    SET podcast_id = v_map.alias_podcast_id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_map.canonical_podcast_id;

    UPDATE public.episode_spotify_meta
    SET podcast_id = v_map.alias_podcast_id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_map.canonical_podcast_id;

    UPDATE public.episode_best_text_source
    SET podcast_id = v_map.alias_podcast_id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_map.canonical_podcast_id;

    UPDATE public.episode_transcripts
    SET podcast_id = v_map.alias_podcast_id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_map.canonical_podcast_id;

    UPDATE public.episode_article_candidates
    SET podcast_id = v_map.alias_podcast_id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_map.canonical_podcast_id;

    UPDATE public.episode_youtube_links
    SET podcast_id = v_map.alias_podcast_id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_map.canonical_podcast_id;

    UPDATE public.person_episode_mentions
    SET podcast_id = v_map.alias_podcast_id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_map.canonical_podcast_id;

    UPDATE public.person_external_sources
    SET podcast_id = v_map.alias_podcast_id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_map.canonical_podcast_id;

    UPDATE public.audio_source_repair_queue
    SET podcast_id = v_map.alias_podcast_id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_map.canonical_podcast_id;

    UPDATE public.youtube_transcript_attempts
    SET podcast_id = v_map.alias_podcast_id
    WHERE episode_id = ANY(v_reassigned_ids) AND podcast_id = v_map.canonical_podcast_id;

    UPDATE public.episode_podcast_reassignments
    SET status = 'reverted', reverted_at = now(), updated_at = now()
    WHERE episode_id = ANY(v_reassigned_ids) AND status = 'active';
  END IF;

  UPDATE public.podcast_canonical_mappings
  SET status = 'reverted', reverted_at = now(), updated_at = now()
  WHERE alias_podcast_id = p_alias_podcast_id;

  WITH rev AS (
    UPDATE public.episode_canonical_mappings
    SET status = 'reverted', updated_at = now()
    WHERE alias_podcast_id = p_alias_podcast_id AND status = 'active'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_ep_reverted FROM rev;

  UPDATE public.podcasts
  SET rss_status = COALESCE(v_map.before_state->>'rss_status', 'active'),
      crawl_state = COALESCE(v_map.before_state->>'crawl_state', 'incremental_refresh'),
      next_fetch_at = NULLIF(v_map.before_state->>'next_fetch_at', '')::timestamptz,
      next_rss_hunt_at = NULLIF(v_map.before_state->>'next_rss_hunt_at', '')::timestamptz,
      updated_at = now()
  WHERE id = p_alias_podcast_id;

  RETURN jsonb_build_object(
    'ok', true,
    'alias_podcast_id', p_alias_podcast_id,
    'alias_slug', v_map.alias_slug,
    'reverted_episode_mappings', v_ep_reverted,
    'reverted_reassigned_episodes', v_reassigned_reverted,
    'restored_state', v_map.before_state
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revert_podcast_canonical_mapping_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revert_podcast_canonical_mapping_v1(uuid) TO service_role;

-- 4. Update resolve_podcast_redirect_v1 to also resolve reassigned unique episode slugs explicitly
CREATE OR REPLACE FUNCTION public.resolve_podcast_redirect_v1(
  p_podcast_slug text,
  p_episode_slug text DEFAULT NULL,
  p_year integer DEFAULT NULL,
  p_page integer DEFAULT NULL
)
RETURNS TABLE(
  redirect_path text,
  reason text,
  canonical_podcast_id uuid,
  canonical_podcast_slug text,
  canonical_episode_id uuid,
  canonical_episode_slug text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_map public.podcast_canonical_mappings%ROWTYPE;
  v_ep_map public.episode_canonical_mappings%ROWTYPE;
  v_reassigned record;
BEGIN
  SELECT * INTO v_map
  FROM public.podcast_canonical_mappings
  WHERE alias_slug = p_podcast_slug
    AND status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Annual archive redirect: /podcast/:alias/epizodok/:year(/oldal/:page)
  IF p_year IS NOT NULL THEN
    IF p_page IS NOT NULL AND p_page > 1 THEN
      redirect_path := '/podcast/' || v_map.canonical_slug || '/epizodok/' || p_year || '/oldal/' || p_page;
    ELSE
      redirect_path := '/podcast/' || v_map.canonical_slug || '/epizodok/' || p_year;
    END IF;
    reason := 'duplicate_show_archive_alias';
    canonical_podcast_id := v_map.canonical_podcast_id;
    canonical_podcast_slug := v_map.canonical_slug;
    canonical_episode_id := NULL;
    canonical_episode_slug := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Episode redirect: /podcast/:alias/:episodeSlug
  IF p_episode_slug IS NOT NULL AND btrim(p_episode_slug) <> '' THEN
    SELECT * INTO v_ep_map
    FROM public.episode_canonical_mappings
    WHERE alias_podcast_id = v_map.alias_podcast_id
      AND alias_episode_slug = p_episode_slug
      AND status = 'active'
    LIMIT 1;

    IF FOUND THEN
      redirect_path := '/podcast/' || v_ep_map.canonical_podcast_slug || '/' || v_ep_map.canonical_episode_slug;
      reason := 'duplicate_episode_alias';
      canonical_podcast_id := v_ep_map.canonical_podcast_id;
      canonical_podcast_slug := v_ep_map.canonical_podcast_slug;
      canonical_episode_id := v_ep_map.canonical_episode_id;
      canonical_episode_slug := v_ep_map.canonical_episode_slug;
      RETURN NEXT;
      RETURN;
    END IF;

    -- Explicitly audited reassigned unique episode (same ID moved onto canonical show)
    SELECT r.episode_id, r.to_podcast_id, r.to_podcast_slug, COALESCE(e.slug, r.episode_slug) AS cur_slug
    INTO v_reassigned
    FROM public.episode_podcast_reassignments r
    JOIN public.episodes e ON e.id = r.episode_id
    WHERE r.from_podcast_id = v_map.alias_podcast_id
      AND r.episode_slug = p_episode_slug
      AND r.status = 'active'
    LIMIT 1;

    IF FOUND THEN
      redirect_path := '/podcast/' || v_reassigned.to_podcast_slug || '/' || v_reassigned.cur_slug;
      reason := 'reassigned_unique_episode';
      canonical_podcast_id := v_reassigned.to_podcast_id;
      canonical_podcast_slug := v_reassigned.to_podcast_slug;
      canonical_episode_id := v_reassigned.episode_id;
      canonical_episode_slug := v_reassigned.cur_slug;
      RETURN NEXT;
      RETURN;
    END IF;

    -- Fallback: exact same slug already exists directly on canonical podcast
    SELECT e.id INTO canonical_episode_id
    FROM public.episodes e
    WHERE e.podcast_id = v_map.canonical_podcast_id
      AND e.slug = p_episode_slug
    LIMIT 1;

    IF canonical_episode_id IS NOT NULL THEN
      redirect_path := '/podcast/' || v_map.canonical_slug || '/' || p_episode_slug;
      reason := 'duplicate_show_episode_same_slug';
      canonical_podcast_id := v_map.canonical_podcast_id;
      canonical_podcast_slug := v_map.canonical_slug;
      canonical_episode_slug := p_episode_slug;
      RETURN NEXT;
      RETURN;
    END IF;

    -- Unmatched episode slug: never alias to home or show root; return empty -> 404
    RETURN;
  END IF;

  -- Show root redirect: /podcast/:alias -> /podcast/:canonical
  redirect_path := '/podcast/' || v_map.canonical_slug;
  reason := 'duplicate_show_alias';
  canonical_podcast_id := v_map.canonical_podcast_id;
  canonical_podcast_slug := v_map.canonical_slug;
  canonical_episode_id := NULL;
  canonical_episode_slug := NULL;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_podcast_redirect_v1(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_podcast_redirect_v1(text, text, integer, integer) TO anon, authenticated, service_role;

-- 5. Apply owner-verified lossless 305-episode GOMBAPRESSZÓ consolidation (gombapresszo -> gombapresszo-1)
DO $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.apply_podcast_lossless_merge_v1(
    '9cb62269-dc86-4fbb-b8ef-eb7dc91f0f73'::uuid,
    'a5092c31-5eea-402b-8697-1e12991efc85'::uuid,
    'gombapresszo',
    jsonb_build_object(
      'podcast_guid', 'd40508af-be15-534a-887c-97e23215468b',
      'publisher', 'Egor Zosma bps Orsa Gomez',
      'apple_id', 'id545161383',
      'alias_feed', 'https://feeds.feedburner.com/gombapresszo',
      'canonical_feed', 'https://feeds.captivate.fm/gombapresszo/',
      'guid_matches_verified', 123,
      'unique_old_episodes_reassigned', 91,
      'verified_by', 'owner_independent_feed_verification_2026_11_27'
    ),
    false
  );

  IF COALESCE((v_res->>'unmatched_alias_episodes')::int, -1) <> 0 THEN
    RAISE EXCEPTION 'Gombapresszo merge left unmatched episodes: %', v_res;
  END IF;
  IF COALESCE((v_res->>'canonical_total_episodes')::int, 0) < 305 THEN
    RAISE EXCEPTION 'Gombapresszo canonical total below expected 305: %', v_res;
  END IF;
END $$;

-- 6. Consistent public-episode filters in annual archive RPCs & sitemap archive listing:
--    exclude future-dated episodes (published_at > now()) and prefetch placeholders (is_prefetch_placeholder IS TRUE).
CREATE OR REPLACE FUNCTION public.get_podcast_archive_years_v1(
  p_podcast_id uuid,
  p_min_episodes integer DEFAULT 3
)
RETURNS TABLE(
  year integer,
  episode_count bigint,
  latest_published_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    EXTRACT(YEAR FROM e.published_at AT TIME ZONE 'UTC')::int AS year,
    COUNT(*)::bigint AS episode_count,
    MAX(e.published_at) AS latest_published_at
  FROM public.episodes e
  WHERE e.podcast_id = p_podcast_id
    AND e.published_at IS NOT NULL
    AND e.published_at <= now()
    AND e.is_prefetch_placeholder IS NOT TRUE
    AND EXTRACT(YEAR FROM e.published_at AT TIME ZONE 'UTC') BETWEEN 2000 AND 2100
    AND NOT EXISTS (
      SELECT 1 FROM public.episode_ingest_exclusions ex
      WHERE ex.podcast_id = e.podcast_id
        AND (
          (ex.guid IS NOT NULL AND e.guid = ex.guid)
          OR (ex.old_slug IS NOT NULL AND e.slug = ex.old_slug)
          OR (ex.asset_id IS NOT NULL AND (
            COALESCE(e.audio_url, '') ILIKE '%' || ex.asset_id || '%'
            OR COALESCE(e.episode_url, '') ILIKE '%' || ex.asset_id || '%'
            OR COALESCE(e.youtube_video_id, '') = ex.asset_id
          ))
        )
    )
  GROUP BY EXTRACT(YEAR FROM e.published_at AT TIME ZONE 'UTC')::int
  HAVING COUNT(*) >= GREATEST(1, COALESCE(p_min_episodes, 3))
  ORDER BY year DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_podcast_archive_years_v1(uuid, integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_podcast_year_archive_page_v1(
  p_podcast_slug text,
  p_year integer,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pod record;
  v_page_size int := GREATEST(1, LEAST(COALESCE(p_page_size, 100), 100));
  v_page int := COALESCE(p_page, 1);
  v_from timestamptz;
  v_to timestamptz;
  v_total bigint := 0;
  v_total_pages int := 0;
  v_offset int := 0;
  v_episodes jsonb := '[]'::jsonb;
  v_years jsonb := '[]'::jsonb;
BEGIN
  IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
    RETURN jsonb_build_object('found', false, 'reason', 'invalid_year');
  END IF;
  IF v_page < 1 THEN
    RETURN jsonb_build_object('found', false, 'reason', 'invalid_page');
  END IF;

  SELECT
    p.id, p.slug, p.title, p.display_title, p.description, p.summary,
    p.image_url, p.category, p.language, p.language_decision, p.rss_status
  INTO v_pod
  FROM public.podcasts p
  WHERE p.slug = p_podcast_slug
    AND p.language_decision = 'accept_hungarian'
    AND COALESCE(p.rss_status, '') <> 'inactive'
    AND NOT EXISTS (
      SELECT 1 FROM public.podcast_canonical_mappings m
      WHERE m.alias_podcast_id = p.id AND m.status = 'active'
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'reason', 'podcast_not_found');
  END IF;

  v_from := make_timestamptz(p_year, 1, 1, 0, 0, 0, 'UTC');
  v_to := make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'UTC');

  SELECT COUNT(*)::bigint INTO v_total
  FROM public.episodes e
  WHERE e.podcast_id = v_pod.id
    AND e.published_at >= v_from
    AND e.published_at < v_to
    AND e.published_at <= now()
    AND e.is_prefetch_placeholder IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1 FROM public.episode_ingest_exclusions ex
      WHERE ex.podcast_id = e.podcast_id
        AND (
          (ex.guid IS NOT NULL AND e.guid = ex.guid)
          OR (ex.old_slug IS NOT NULL AND e.slug = ex.old_slug)
          OR (ex.asset_id IS NOT NULL AND (
            COALESCE(e.audio_url, '') ILIKE '%' || ex.asset_id || '%'
            OR COALESCE(e.episode_url, '') ILIKE '%' || ex.asset_id || '%'
            OR COALESCE(e.youtube_video_id, '') = ex.asset_id
          ))
        )
    );

  IF v_total < 3 THEN
    RETURN jsonb_build_object('found', false, 'reason', 'below_min_episodes', 'total_count', v_total);
  END IF;

  v_total_pages := CEIL(v_total::numeric / v_page_size::numeric)::int;
  IF v_page > v_total_pages THEN
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'page_out_of_range',
      'total_count', v_total,
      'total_pages', v_total_pages
    );
  END IF;

  v_offset := (v_page - 1) * v_page_size;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_episodes
  FROM (
    SELECT
      e.id,
      e.title,
      e.display_title,
      e.slug,
      e.published_at,
      e.summary,
      e.description,
      e.ai_summary,
      ec.card_summary,
      e.audio_url,
      e.audio_health_status,
      e.audio_manual_override,
      e.image_url,
      e.episode_url,
      e.spotify_url,
      e.apple_url,
      e.youtube_url
    FROM public.episodes e
    LEFT JOIN public.episode_cards ec ON ec.episode_id = e.id
    WHERE e.podcast_id = v_pod.id
      AND e.published_at >= v_from
      AND e.published_at < v_to
      AND e.published_at <= now()
      AND e.is_prefetch_placeholder IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.episode_ingest_exclusions ex
        WHERE ex.podcast_id = e.podcast_id
          AND (
            (ex.guid IS NOT NULL AND e.guid = ex.guid)
            OR (ex.old_slug IS NOT NULL AND e.slug = ex.old_slug)
            OR (ex.asset_id IS NOT NULL AND (
              COALESCE(e.audio_url, '') ILIKE '%' || ex.asset_id || '%'
              OR COALESCE(e.episode_url, '') ILIKE '%' || ex.asset_id || '%'
              OR COALESCE(e.youtube_video_id, '') = ex.asset_id
            ))
          )
      )
    ORDER BY e.published_at DESC, e.id DESC
    LIMIT v_page_size OFFSET v_offset
  ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'year', y.year,
    'episode_count', y.episode_count
  ) ORDER BY y.year DESC), '[]'::jsonb)
  INTO v_years
  FROM public.get_podcast_archive_years_v1(v_pod.id, 3) y;

  RETURN jsonb_build_object(
    'found', true,
    'podcast', jsonb_build_object(
      'id', v_pod.id,
      'slug', v_pod.slug,
      'title', v_pod.title,
      'display_title', v_pod.display_title,
      'description', v_pod.description,
      'summary', v_pod.summary,
      'image_url', v_pod.image_url,
      'category', v_pod.category,
      'language', v_pod.language
    ),
    'year', p_year,
    'page', v_page,
    'page_size', v_page_size,
    'total_count', v_total,
    'total_pages', v_total_pages,
    'episodes', v_episodes,
    'years', v_years,
    'available_years', v_years
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_podcast_year_archive_page_v1(text, integer, integer, integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_sitemap_podcast_annual_archives_v1(
  p_min_episodes integer DEFAULT 3,
  p_page_size integer DEFAULT 100
)
RETURNS TABLE(
  podcast_slug text,
  year integer,
  episode_count bigint,
  total_pages integer,
  lastmod timestamptz,
  rank_label text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '15s'
AS $$
  SELECT
    p.slug AS podcast_slug,
    EXTRACT(YEAR FROM e.published_at AT TIME ZONE 'UTC')::int AS year,
    COUNT(*)::bigint AS episode_count,
    CEIL(COUNT(*)::numeric / GREATEST(1, LEAST(COALESCE(p_page_size, 100), 100))::numeric)::int AS total_pages,
    MAX(GREATEST(COALESCE(e.updated_at, e.published_at), e.published_at)) AS lastmod,
    p.rank_label
  FROM public.podcasts p
  JOIN public.episodes e ON e.podcast_id = p.id
  WHERE p.language_decision = 'accept_hungarian'
    AND COALESCE(p.rss_status, '') <> 'inactive'
    AND p.slug IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.podcast_canonical_mappings m
      WHERE m.alias_podcast_id = p.id AND m.status = 'active'
    )
    AND e.published_at IS NOT NULL
    AND e.published_at <= now()
    AND e.is_prefetch_placeholder IS NOT TRUE
    AND EXTRACT(YEAR FROM e.published_at AT TIME ZONE 'UTC') BETWEEN 2000 AND 2100
    AND NOT EXISTS (
      SELECT 1 FROM public.episode_ingest_exclusions ex
      WHERE ex.podcast_id = e.podcast_id
        AND (
          (ex.guid IS NOT NULL AND e.guid = ex.guid)
          OR (ex.old_slug IS NOT NULL AND e.slug = ex.old_slug)
          OR (ex.asset_id IS NOT NULL AND (
            COALESCE(e.audio_url, '') ILIKE '%' || ex.asset_id || '%'
            OR COALESCE(e.episode_url, '') ILIKE '%' || ex.asset_id || '%'
            OR COALESCE(e.youtube_video_id, '') = ex.asset_id
          ))
        )
    )
  GROUP BY p.id, p.slug, p.rank_label, EXTRACT(YEAR FROM e.published_at AT TIME ZONE 'UTC')::int
  HAVING COUNT(*) >= GREATEST(1, COALESCE(p_min_episodes, 3))
  ORDER BY p.slug, year DESC;
$$;

REVOKE ALL ON FUNCTION public.list_sitemap_podcast_annual_archives_v1(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_sitemap_podcast_annual_archives_v1(integer, integer) TO service_role;