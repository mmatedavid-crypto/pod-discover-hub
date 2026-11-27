-- 1. Reversible duplicate-show canonical mapping tables
CREATE TABLE IF NOT EXISTS public.podcast_canonical_mappings (
  alias_podcast_id uuid PRIMARY KEY REFERENCES public.podcasts(id) ON DELETE CASCADE,
  canonical_podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  alias_slug text NOT NULL,
  canonical_slug text NOT NULL,
  group_key text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reverted')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT podcast_canonical_mappings_no_self CHECK (alias_podcast_id <> canonical_podcast_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_podcast_canonical_mappings_active_alias_slug
  ON public.podcast_canonical_mappings (alias_slug)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_podcast_canonical_mappings_canonical_active
  ON public.podcast_canonical_mappings (canonical_podcast_id)
  WHERE status = 'active';

GRANT SELECT ON public.podcast_canonical_mappings TO anon, authenticated;
GRANT ALL ON public.podcast_canonical_mappings TO service_role;

ALTER TABLE public.podcast_canonical_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active podcast canonical mappings" ON public.podcast_canonical_mappings;
CREATE POLICY "Public can read active podcast canonical mappings"
  ON public.podcast_canonical_mappings
  FOR SELECT
  TO anon, authenticated
  USING (status = 'active');

CREATE TABLE IF NOT EXISTS public.episode_canonical_mappings (
  alias_episode_id uuid PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
  canonical_episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  alias_podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  canonical_podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  alias_podcast_slug text NOT NULL,
  alias_episode_slug text NOT NULL,
  canonical_podcast_slug text NOT NULL,
  canonical_episode_slug text NOT NULL,
  match_method text NOT NULL CHECK (match_method IN ('exact_guid', 'exact_audio_url')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reverted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT episode_canonical_mappings_no_self CHECK (alias_episode_id <> canonical_episode_id)
);

CREATE INDEX IF NOT EXISTS idx_episode_canonical_mappings_slug_lookup
  ON public.episode_canonical_mappings (alias_podcast_slug, alias_episode_slug)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_episode_canonical_mappings_alias_pod
  ON public.episode_canonical_mappings (alias_podcast_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_episode_canonical_mappings_canonical_ep
  ON public.episode_canonical_mappings (canonical_episode_id)
  WHERE status = 'active';

GRANT SELECT ON public.episode_canonical_mappings TO anon, authenticated;
GRANT ALL ON public.episode_canonical_mappings TO service_role;

ALTER TABLE public.episode_canonical_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active episode canonical mappings" ON public.episode_canonical_mappings;
CREATE POLICY "Public can read active episode canonical mappings"
  ON public.episode_canonical_mappings
  FOR SELECT
  TO anon, authenticated
  USING (status = 'active');

-- Prevent chains or cycles in podcast_canonical_mappings
CREATE OR REPLACE FUNCTION public.guard_podcast_canonical_mapping_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    IF EXISTS (
      SELECT 1 FROM public.podcast_canonical_mappings m
      WHERE m.status = 'active'
        AND m.alias_podcast_id = NEW.canonical_podcast_id
        AND m.alias_podcast_id <> NEW.alias_podcast_id
    ) THEN
      RAISE EXCEPTION 'canonical podcast % is already an active alias', NEW.canonical_podcast_id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.podcast_canonical_mappings m
      WHERE m.status = 'active'
        AND m.canonical_podcast_id = NEW.alias_podcast_id
        AND m.alias_podcast_id <> NEW.alias_podcast_id
    ) THEN
      RAISE EXCEPTION 'alias podcast % is already canonical for another active mapping', NEW.alias_podcast_id;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_podcast_canonical_mapping ON public.podcast_canonical_mappings;
CREATE TRIGGER trg_guard_podcast_canonical_mapping
  BEFORE INSERT OR UPDATE ON public.podcast_canonical_mappings
  FOR EACH ROW EXECUTE FUNCTION public.guard_podcast_canonical_mapping_v1();

-- 2. Conservative trailing whitespace & %20 normalization in normalize_rss_url
CREATE OR REPLACE FUNCTION public.normalize_rss_url(_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  u text; host text; path_q text; path_only text; query_str text;
  parts text[]; kept text[] := '{}'; kv text; k text;
BEGIN
  IF _url IS NULL THEN RETURN NULL; END IF;
  u := btrim(_url);
  -- Conservatively strip leading/trailing literal or percent-encoded whitespace (%20, %09, %0A, %0D)
  u := regexp_replace(u, '^(\s|%20|%09|%0[aAdD])+', '', 'gi');
  u := regexp_replace(u, '(\s|%20|%09|%0[aAdD])+$', '', 'gi');
  IF u = '' THEN RETURN NULL; END IF;
  u := regexp_replace(u, '^[Hh][Tt][Tt][Pp][Ss]?://', '', 'g');
  IF position('/' in u) > 0 THEN
    host := lower(split_part(u, '/', 1));
    path_q := substring(u from position('/' in u));
  ELSE
    host := lower(u); path_q := '/';
  END IF;
  host := regexp_replace(host, '^www\.', '');
  IF position('?' in path_q) > 0 THEN
    path_only := split_part(path_q, '?', 1);
    query_str := substring(path_q from position('?' in path_q) + 1);
  ELSE
    path_only := path_q; query_str := '';
  END IF;
  -- Strip trailing encoded whitespace on the path segment before trailing-slash cleanup
  path_only := regexp_replace(path_only, '(%20|%09|%0[aAdD])+$', '', 'gi');
  IF length(path_only) > 1 THEN
    path_only := regexp_replace(path_only, '/+$', '');
  END IF;
  IF query_str <> '' THEN
    parts := string_to_array(query_str, '&');
    FOREACH kv IN ARRAY parts LOOP
      k := lower(split_part(kv, '=', 1));
      IF k NOT LIKE 'utm_%'
         AND k NOT IN ('fbclid','gclid','mc_cid','mc_eid','igshid','ref','ref_src','source','referer','referrer','_hsenc','_hsmi') THEN
        kept := array_append(kept, kv);
      END IF;
    END LOOP;
    IF array_length(kept, 1) IS NOT NULL THEN
      RETURN 'https://' || host || path_only || '?' || array_to_string(kept, '&');
    END IF;
  END IF;
  RETURN 'https://' || host || path_only;
END $function$;

-- Backfill rss_url_norm only where conservative whitespace/%20 normalization changes it
UPDATE public.podcasts
SET rss_url_norm = public.normalize_rss_url(rss_url)
WHERE rss_url IS NOT NULL
  AND rss_url_norm IS DISTINCT FROM public.normalize_rss_url(rss_url);

-- Resolve find_existing_podcast to canonical when matched row is an active alias
CREATE OR REPLACE FUNCTION public.find_existing_podcast(p_rss_url text, p_title text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_norm_url text;
  v_norm_title text;
  v_id uuid;
  v_canon uuid;
BEGIN
  -- 1) Exact RSS URL match
  SELECT id INTO v_id FROM public.podcasts WHERE rss_url = p_rss_url LIMIT 1;

  -- 2) Normalized RSS URL match (handles trailing whitespace/%20 conservatively)
  IF v_id IS NULL THEN
    BEGIN
      v_norm_url := public.normalize_rss_url(p_rss_url);
    EXCEPTION WHEN OTHERS THEN
      v_norm_url := NULL;
    END;
    IF v_norm_url IS NOT NULL THEN
      SELECT id INTO v_id FROM public.podcasts WHERE rss_url_norm = v_norm_url LIMIT 1;
    END IF;
  END IF;

  -- 3) Normalized title match (HU-only catalog; prefer canonical non-alias rows)
  IF v_id IS NULL AND p_title IS NOT NULL AND length(trim(p_title)) >= 4 THEN
    BEGIN
      v_norm_title := public.normalize_podcast_title(p_title);
    EXCEPTION WHEN OTHERS THEN
      v_norm_title := NULL;
    END;
    IF v_norm_title IS NOT NULL AND length(v_norm_title) >= 4 THEN
      SELECT p.id INTO v_id
      FROM public.podcasts p
      LEFT JOIN public.podcast_canonical_mappings m
        ON m.alias_podcast_id = p.id AND m.status = 'active'
      WHERE public.normalize_podcast_title(p.title) = v_norm_title
        AND (p.language IS NULL OR p.language ILIKE 'hu%')
      ORDER BY (m.alias_podcast_id IS NULL) DESC, COALESCE(p.podiverzum_rank, 0) DESC
      LIMIT 1;
    END IF;
  END IF;

  IF v_id IS NULL THEN RETURN NULL; END IF;

  -- Redirect matched alias feed/show to its active canonical podcast
  SELECT canonical_podcast_id INTO v_canon
  FROM public.podcast_canonical_mappings
  WHERE alias_podcast_id = v_id AND status = 'active'
  LIMIT 1;

  RETURN COALESCE(v_canon, v_id);
END;
$function$;

-- 3. Reversible apply & revert RPCs (service_role only; zero hard deletes)
CREATE OR REPLACE FUNCTION public.apply_podcast_canonical_mapping_v1(
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
  v_existing public.podcast_canonical_mappings%ROWTYPE;
  v_before jsonb;
  v_guid_mapped int := 0;
  v_audio_mapped int := 0;
  v_unmatched int := 0;
BEGIN
  IF p_alias_podcast_id = p_canonical_podcast_id THEN
    RAISE EXCEPTION 'alias and canonical podcast must differ';
  END IF;

  SELECT * INTO v_alias FROM public.podcasts WHERE id = p_alias_podcast_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'alias podcast % not found', p_alias_podcast_id; END IF;

  SELECT * INTO v_canon FROM public.podcasts WHERE id = p_canonical_podcast_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'canonical podcast % not found', p_canonical_podcast_id; END IF;

  SELECT * INTO v_existing
  FROM public.podcast_canonical_mappings
  WHERE alias_podcast_id = p_alias_podcast_id;

  IF FOUND AND v_existing.status = 'active' THEN
    v_before := v_existing.before_state;
  ELSE
    v_before := jsonb_build_object(
      'rss_status', v_alias.rss_status,
      'crawl_state', v_alias.crawl_state,
      'next_fetch_at', v_alias.next_fetch_at,
      'next_rss_hunt_at', v_alias.next_rss_hunt_at
    );
  END IF;

  INSERT INTO public.podcast_canonical_mappings (
    alias_podcast_id, canonical_podcast_id, alias_slug, canonical_slug,
    group_key, status, evidence, before_state, applied_at, reverted_at
  ) VALUES (
    v_alias.id, v_canon.id, v_alias.slug, v_canon.slug,
    p_group_key, 'active', COALESCE(p_evidence, '{}'::jsonb), v_before, now(), NULL
  )
  ON CONFLICT (alias_podcast_id) DO UPDATE SET
    canonical_podcast_id = EXCLUDED.canonical_podcast_id,
    alias_slug = EXCLUDED.alias_slug,
    canonical_slug = EXCLUDED.canonical_slug,
    group_key = EXCLUDED.group_key,
    status = 'active',
    evidence = EXCLUDED.evidence,
    before_state = EXCLUDED.before_state,
    applied_at = now(),
    reverted_at = NULL,
    updated_at = now();

  -- Map alias episodes by exact non-empty trimmed GUID first
  WITH matched AS (
    SELECT DISTINCT ON (ea.id)
      ea.id AS alias_ep_id,
      ec.id AS canon_ep_id,
      ea.slug AS alias_ep_slug,
      ec.slug AS canon_ep_slug
    FROM public.episodes ea
    JOIN public.episodes ec
      ON ec.podcast_id = v_canon.id
     AND ea.guid IS NOT NULL AND btrim(ea.guid) <> ''
     AND ec.guid IS NOT NULL AND btrim(ec.guid) = btrim(ea.guid)
    WHERE ea.podcast_id = v_alias.id
    ORDER BY ea.id, ec.published_at DESC NULLS LAST, ec.updated_at DESC NULLS LAST, ec.id DESC
  ),
  upserted AS (
    INSERT INTO public.episode_canonical_mappings (
      alias_episode_id, canonical_episode_id,
      alias_podcast_id, canonical_podcast_id,
      alias_podcast_slug, alias_episode_slug,
      canonical_podcast_slug, canonical_episode_slug,
      match_method, status
    )
    SELECT
      m.alias_ep_id, m.canon_ep_id,
      v_alias.id, v_canon.id,
      v_alias.slug, m.alias_ep_slug,
      v_canon.slug, m.canon_ep_slug,
      'exact_guid', 'active'
    FROM matched m
    ON CONFLICT (alias_episode_id) DO UPDATE SET
      canonical_episode_id = EXCLUDED.canonical_episode_id,
      alias_podcast_id = EXCLUDED.alias_podcast_id,
      canonical_podcast_id = EXCLUDED.canonical_podcast_id,
      alias_podcast_slug = EXCLUDED.alias_podcast_slug,
      alias_episode_slug = EXCLUDED.alias_episode_slug,
      canonical_podcast_slug = EXCLUDED.canonical_podcast_slug,
      canonical_episode_slug = EXCLUDED.canonical_episode_slug,
      match_method = EXCLUDED.match_method,
      status = 'active',
      updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_guid_mapped FROM upserted;

  -- Optional exact audio_url fallback (for verified syndication mirrors whose RSS host rewrote GUIDs)
  IF p_allow_audio_fallback THEN
    WITH matched_audio AS (
      SELECT DISTINCT ON (ea.id)
        ea.id AS alias_ep_id,
        ec.id AS canon_ep_id,
        ea.slug AS alias_ep_slug,
        ec.slug AS canon_ep_slug
      FROM public.episodes ea
      JOIN public.episodes ec
        ON ec.podcast_id = v_canon.id
       AND ea.audio_url IS NOT NULL AND btrim(ea.audio_url) <> ''
       AND ec.audio_url = ea.audio_url
      WHERE ea.podcast_id = v_alias.id
        AND NOT EXISTS (
          SELECT 1 FROM public.episode_canonical_mappings em
          WHERE em.alias_episode_id = ea.id AND em.status = 'active'
        )
      ORDER BY ea.id, ec.published_at DESC NULLS LAST, ec.updated_at DESC NULLS LAST, ec.id DESC
    ),
    upserted_audio AS (
      INSERT INTO public.episode_canonical_mappings (
        alias_episode_id, canonical_episode_id,
        alias_podcast_id, canonical_podcast_id,
        alias_podcast_slug, alias_episode_slug,
        canonical_podcast_slug, canonical_episode_slug,
        match_method, status
      )
      SELECT
        m.alias_ep_id, m.canon_ep_id,
        v_alias.id, v_canon.id,
        v_alias.slug, m.alias_ep_slug,
        v_canon.slug, m.canon_ep_slug,
        'exact_audio_url', 'active'
      FROM matched_audio m
      ON CONFLICT (alias_episode_id) DO UPDATE SET
        canonical_episode_id = EXCLUDED.canonical_episode_id,
        alias_podcast_id = EXCLUDED.alias_podcast_id,
        canonical_podcast_id = EXCLUDED.canonical_podcast_id,
        alias_podcast_slug = EXCLUDED.alias_podcast_slug,
        alias_episode_slug = EXCLUDED.alias_episode_slug,
        canonical_podcast_slug = EXCLUDED.canonical_podcast_slug,
        canonical_episode_slug = EXCLUDED.canonical_episode_slug,
        match_method = EXCLUDED.match_method,
        status = 'active',
        updated_at = now()
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_audio_mapped FROM upserted_audio;
  END IF;

  SELECT COUNT(*) INTO v_unmatched
  FROM public.episodes ea
  WHERE ea.podcast_id = v_alias.id
    AND NOT EXISTS (
      SELECT 1 FROM public.episode_canonical_mappings em
      WHERE em.alias_episode_id = ea.id AND em.status = 'active'
    );

  -- Non-destructively deactivate alias feed from public catalogs, search & background refresh
  UPDATE public.podcasts
  SET rss_status = 'inactive',
      crawl_state = 'merged_duplicate',
      next_fetch_at = NULL,
      next_rss_hunt_at = NULL,
      updated_at = now()
  WHERE id = v_alias.id;

  RETURN jsonb_build_object(
    'ok', true,
    'group_key', p_group_key,
    'alias_podcast_id', v_alias.id,
    'alias_slug', v_alias.slug,
    'canonical_podcast_id', v_canon.id,
    'canonical_slug', v_canon.slug,
    'guid_mapped', v_guid_mapped,
    'audio_mapped', v_audio_mapped,
    'unmatched_alias_episodes', v_unmatched
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_podcast_canonical_mapping_v1(p_alias_podcast_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_map public.podcast_canonical_mappings%ROWTYPE;
  v_ep_reverted int := 0;
BEGIN
  SELECT * INTO v_map
  FROM public.podcast_canonical_mappings
  WHERE alias_podcast_id = p_alias_podcast_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_active_mapping');
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
    'restored_state', v_map.before_state
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_podcast_canonical_mapping_v1(uuid, uuid, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_podcast_canonical_mapping_v1(uuid, uuid, text, jsonb, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.revert_podcast_canonical_mapping_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revert_podcast_canonical_mapping_v1(uuid) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    REVOKE ALL ON FUNCTION public.apply_podcast_canonical_mapping_v1(uuid, uuid, text, jsonb, boolean) FROM readonly_codex;
    REVOKE ALL ON FUNCTION public.revert_podcast_canonical_mapping_v1(uuid) FROM readonly_codex;
  END IF;
END $$;

-- 4. Public read-only redirect resolver for alias shows, episodes, and annual archives
-- Never aliases unmatched/invalid old episode slugs to home (returns empty set -> 404).
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
  v_ep_exists boolean;
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

GRANT EXECUTE ON FUNCTION public.resolve_podcast_redirect_v1(text, text, integer, integer) TO anon, authenticated, service_role;

-- Resolve saved episode IDs to canonical episode details if the episode belongs to an active alias
CREATE OR REPLACE FUNCTION public.resolve_canonical_episode_by_id_v1(p_episode_id uuid)
RETURNS TABLE(
  canonical_episode_id uuid,
  canonical_podcast_id uuid,
  canonical_podcast_slug text,
  canonical_episode_slug text,
  is_aliased boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(em.canonical_episode_id, e.id) AS canonical_episode_id,
    COALESCE(em.canonical_podcast_id, p.id) AS canonical_podcast_id,
    COALESCE(em.canonical_podcast_slug, p.slug) AS canonical_podcast_slug,
    COALESCE(em.canonical_episode_slug, e.slug) AS canonical_episode_slug,
    (em.alias_episode_id IS NOT NULL) AS is_aliased
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  LEFT JOIN public.episode_canonical_mappings em
    ON em.alias_episode_id = e.id AND em.status = 'active'
  WHERE e.id = p_episode_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_canonical_episode_by_id_v1(uuid) TO anon, authenticated, service_role;

-- 5. Exclude deactivated alias podcasts from remaining public RPCs
CREATE OR REPLACE FUNCTION public.is_publicly_visible_hu_podcast(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.podcasts p
    WHERE p.id = p_id
      AND p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND COALESCE(p.rss_status, '') <> 'inactive'
      AND NOT EXISTS (
        SELECT 1 FROM public.podcast_canonical_mappings m
        WHERE m.alias_podcast_id = p.id AND m.status = 'active'
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.category_episodes(_slug text, _limit integer DEFAULT 120)
RETURNS TABLE(id uuid, title text, display_title text, slug text, image_url text, published_at timestamp with time zone, ai_summary text, audio_url text, people text[], mentioned text[], topics text[], companies text[], tickers text[], podcast_id uuid, podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text, podcast_category text, podcast_rank numeric, podcast_rank_label text, podcast_rss_status text, podcast_featured boolean, source text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '12s'
AS $function$
  SELECT e.episode_id, e.title, e.display_title, e.slug, e.image_url, e.published_at,
         e.card_summary, e.audio_url, e.people, e.mentioned, e.topics, e.companies, e.tickers,
         e.podcast_id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured, 'classification'
  FROM public.episode_cards e
  JOIN public.podcasts p
    ON p.id = e.podcast_id
   AND p.language_decision = 'accept_hungarian'
   AND COALESCE(p.rss_status, '') <> 'inactive'
  WHERE NOT EXISTS (
      SELECT 1 FROM public.podcast_canonical_mappings m
      WHERE m.alias_podcast_id = p.id AND m.status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.episode_ai_classifications c
      WHERE c.episode_id = e.episode_id
        AND c.classification_status = 'classified'
        AND (c.primary_category = _slug OR c.secondary_categories @> to_jsonb(array[_slug]))
    )
  ORDER BY e.published_at DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(_limit, 120), 300));
$function$;

CREATE OR REPLACE FUNCTION public.top_episodes_all_time(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_podcast_slug text DEFAULT NULL::text, p_one_per_podcast boolean DEFAULT false)
RETURNS TABLE(episode_id uuid, episode_slug text, episode_title text, episode_image text, published_at timestamp with time zone, view_count bigint, youtube_video_id text, podcast_id uuid, podcast_slug text, podcast_title text, podcast_image text, rank_label text, chart_appearances integer, popularity_score numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '12s'
AS $function$
  WITH lean AS (
    SELECT eyl.episode_id, eyl.podcast_id, eyl.youtube_video_id,
           eyl.youtube_view_count::bigint AS view_count,
           ROW_NUMBER() OVER (
             PARTITION BY CASE WHEN p_one_per_podcast THEN eyl.podcast_id ELSE eyl.episode_id END
             ORDER BY eyl.youtube_view_count DESC NULLS LAST
           ) AS rn
    FROM public.episode_youtube_links eyl
    JOIN public.podcasts p ON p.id = eyl.podcast_id
    WHERE eyl.status = 'confirmed'
      AND eyl.youtube_view_count > 0
      AND p.language ILIKE 'hu%'
      AND COALESCE(p.rss_status, '') NOT IN ('dead','spam','removed','inactive')
      AND NOT EXISTS (
        SELECT 1 FROM public.podcast_canonical_mappings m
        WHERE m.alias_podcast_id = p.id AND m.status = 'active'
      )
      AND (p_podcast_slug IS NULL OR p.slug = p_podcast_slug)
  ), page AS (
    SELECT * FROM lean
    WHERE (NOT p_one_per_podcast) OR rn = 1
    ORDER BY view_count DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  )
  SELECT e.id, e.slug, COALESCE(e.display_title, e.title), e.image_url, e.published_at,
         pg.view_count, pg.youtube_video_id,
         p.id, p.slug, COALESCE(p.display_title, p.title), p.image_url, p.rank_label,
         ca.cnt::int,
         (ln(GREATEST(pg.view_count, 10))::numeric * 10
          + CASE p.rank_label WHEN 'S' THEN 5 WHEN 'A' THEN 3 WHEN 'B' THEN 2 WHEN 'C' THEN 1 ELSE 0 END
          + LEAST(ca.cnt, 20) * 0.4)::numeric
  FROM page pg
  JOIN public.episodes e ON e.id = pg.episode_id
  JOIN public.podcasts p ON p.id = pg.podcast_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(count(*), 0)::int AS cnt FROM public.podcast_charts pc
    WHERE pc.podcast_id = pg.podcast_id AND pc.country = 'hu'
  ) ca
  ORDER BY pg.view_count DESC NULLS LAST;
$function$;

-- 6. Task 2: Index-friendly exact-count paginated annual archives (no 200-episode limit)
CREATE INDEX IF NOT EXISTS idx_episodes_podcast_pub_id_desc
  ON public.episodes (podcast_id, published_at DESC, id DESC)
  WHERE published_at IS NOT NULL;

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
    'years', v_years
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_podcast_year_archive_page_v1(text, integer, integer, integer) TO anon, authenticated, service_role;

-- Bounded indexed annual-archive list for sitemap generation (canonical HU shows only)
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
