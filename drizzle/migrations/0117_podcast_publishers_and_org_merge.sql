-- 1) Publisher fields from feed headers (server-only; owner e-mail reduced to its domain).
CREATE TABLE IF NOT EXISTS public.podcast_channel_meta (
  podcast_id uuid PRIMARY KEY REFERENCES public.podcasts(id) ON DELETE CASCADE,
  author text,
  owner_name text,
  owner_email_domain text,
  copyright text,
  channel_link text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.podcast_channel_meta TO service_role;
ALTER TABLE public.podcast_channel_meta ENABLE ROW LEVEL SECURITY;

-- 2) Podcast -> publishing organization (deterministic, evidence recorded; manual rows are never touched).
CREATE TABLE IF NOT EXISTS public.podcast_publishers (
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('accepted','ambiguous','manual_accepted','manual_rejected')),
  strength numeric NOT NULL DEFAULT 0,
  sources text[] NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (podcast_id, organization_id)
);
CREATE INDEX IF NOT EXISTS podcast_publishers_org_idx ON public.podcast_publishers (organization_id) WHERE status IN ('accepted','manual_accepted');
GRANT SELECT ON public.podcast_publishers TO anon, authenticated;
GRANT ALL ON public.podcast_publishers TO service_role;
ALTER TABLE public.podcast_publishers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Accepted publishers are public" ON public.podcast_publishers;
CREATE POLICY "Accepted publishers are public" ON public.podcast_publishers
  FOR SELECT TO anon, authenticated USING (status IN ('accepted','manual_accepted'));

-- 3) Name/domain keys, mirroring organizations-backfill-runner normalize().
CREATE OR REPLACE FUNCTION public.org_name_key_v1(_s text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT NULLIF(btrim(regexp_replace(
           regexp_replace(lower(public.unaccent(coalesce(_s, ''))), '\m(nyrt|zrt|kft|bt|kkt|rt|gmbh|inc|llc|ltd|plc|co|corp)\M\.?', ' ', 'g'),
           '[^a-z0-9]+', ' ', 'g')), '')
$$;

CREATE OR REPLACE FUNCTION public.publisher_name_key_v1(_s text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT NULLIF(btrim(regexp_replace(regexp_replace(
           public.org_name_key_v1(regexp_replace(coalesce(_s, ''), '(©|\(c\)|copyright|all rights reserved|minden jog fenntartva|\m(19|20)[0-9]{2}\M|\m[0-9]{5,}\M)', ' ', 'gi')),
           '\s+(media|podcast|podcastok|podcastek|podcasts|studio|official|hivatalos|csatorna|channel|hu|com)$', ''),
           '\s+(media|podcast|podcastok|podcastek|podcasts|studio|official|hivatalos|csatorna|channel|hu|com)$', '')), '')
$$;

CREATE OR REPLACE FUNCTION public.publisher_domain_label_v1(_url_or_host text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH h AS (
    SELECT regexp_replace(lower(coalesce(substring(_url_or_host FROM '^[a-zA-Z]+://([^/:?#]+)'), _url_or_host, '')), '^www\.', '') AS host
  ), p AS (SELECT string_to_array(host, '.') AS parts, host FROM h)
  SELECT CASE
    WHEN host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.(hu|com|net|org|eu|tv|fm|info|ro|sk|rs|at|de|media|io)$' AND array_length(parts, 1) >= 2
      THEN parts[array_length(parts, 1) - 1] END
  FROM p
$$;

-- 4) Recompute podcast publishers (idempotent, set-based, no AI).
CREATE OR REPLACE FUNCTION public.refresh_podcast_publishers_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '60s' AS $$
DECLARE
  v_platforms text[] := ARRAY['anchor','spotify','spotifyforpodcasters','podcasters','soundcloud','apple','podcasts','rss','omnycontent','omny','buzzsprout','libsyn','podbean','spreaker','simplecast','megaphone','transistor','captivate','acast','youtube','youtu','facebook','instagram','tiktok','twitter','x','linktr','linktree','gmail','googlemail','freemail','citromail','yahoo','hotmail','outlook','icloud','me','live','t-online','google','blogspot','wordpress','substack','patreon','twitch','mixcloud','podigee','redcircle','audioboom','pinecast','castos','fireside','feedburner','feedpress','ivoox','podomatic','wix','wixsite','squarespace','weebly','github','gitlab','podcast','podcastok','inda','mailchimp','riverside','zencast','podhero','castbox','pocketcasts','deezer','amazon','audible','iheart','tunein','player','hearthis','archive','vimeo','rumble','telegram','discord','medium','notion','canva','webnode','blog','site','studio','media','radio','tv','fm','hu','com','info','online','mail'];
  v_upserted int := 0; v_removed int := 0;
BEGIN
  CREATE TEMP TABLE _pp_new ON COMMIT DROP AS
  WITH pods AS (
    SELECT p.id, p.title, p.display_title, p.website_url, p.description,
           m.author, m.owner_name, m.owner_email_domain, m.copyright, m.channel_link,
           public.org_name_key_v1(p.title) AS t1, public.org_name_key_v1(p.display_title) AS t2
      FROM public.podcasts p LEFT JOIN public.podcast_channel_meta m ON m.podcast_id = p.id
     WHERE p.language_decision = 'accept_hungarian'
  ), keys AS (
    SELECT id AS pid, t1, t2, k.key, k.src, k.strength, k.is_domain FROM pods,
    LATERAL (VALUES
      (public.org_name_key_v1(author), 'rss_author', 3.0, false),
      (public.publisher_name_key_v1(author), 'rss_author', 3.0, false),
      (public.org_name_key_v1(owner_name), 'rss_owner', 3.0, false),
      (public.publisher_name_key_v1(owner_name), 'rss_owner', 3.0, false),
      (public.publisher_name_key_v1(regexp_replace(coalesce(copyright, ''), '[a-z0-9-]+\.(hu|com|net|org|eu)\M', ' ', 'gi')), 'rss_copyright', 3.0, false),
      (public.publisher_domain_label_v1(owner_email_domain), 'owner_email_domain', 3.0, true),
      (public.publisher_domain_label_v1(website_url), 'website', 3.0, true),
      (public.publisher_domain_label_v1(channel_link), 'channel_link', 3.0, true)
    ) AS k(key, src, strength, is_domain)
    UNION ALL
    SELECT id, t1, t2, public.org_name_key_v1(seg), 'title_segment', 2.0, false
      FROM pods, LATERAL regexp_split_to_table(coalesce(title, ''), '\s*\|\s*|\s+[–—-]\s+') AS seg
     WHERE coalesce(title, '') ~ '\s*\|\s*|\s+[–—-]\s+'
    UNION ALL
    SELECT id, t1, t2, public.publisher_domain_label_v1(mm[1]), 'description_email', 1.5, true
      FROM pods, LATERAL regexp_matches(coalesce(description, ''), '[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})', 'g') AS mm
  ), k2 AS (
    SELECT * FROM keys WHERE key IS NOT NULL AND length(key) >= 2 AND NOT (key = ANY (v_platforms))
  ), cand AS (
    SELECT COALESCE(o.ai_duplicate_of_organization_id, o.id) AS org_id, o.normalized_name AS key
      FROM public.organizations o WHERE o.normalized_name IS NOT NULL AND o.normalized_name NOT LIKE 'merged %'
    UNION
    SELECT COALESCE(o.ai_duplicate_of_organization_id, o.id), a.normalized_alias
      FROM public.organization_aliases a JOIN public.organizations o ON o.id = a.organization_id
     WHERE a.status IN ('accepted','verified')
  ), cand_ok AS (
    SELECT c.org_id, c.key, replace(c.key, ' ', '') AS key_ns, o.org_type, o.normalized_name AS org_key
      FROM cand c JOIN public.organizations o ON o.id = c.org_id
     WHERE o.org_type <> 'other' AND o.quality_hold_at IS NULL
       AND o.ai_duplicate_of_organization_id IS NULL
       AND COALESCE(o.ai_recommended_action, '') NOT IN ('hide','reject')
  ), matches AS (
    SELECT k2.pid, c.org_id, k2.src, k2.key, k2.strength, k2.t1, k2.t2, c.org_type, c.org_key
      FROM k2 JOIN cand_ok c ON c.key = k2.key
    UNION
    SELECT k2.pid, c.org_id, k2.src, k2.key, k2.strength, k2.t1, k2.t2, c.org_type, c.org_key
      FROM k2 JOIN cand_ok c ON k2.is_domain AND c.key_ns = k2.key
  ), scored AS (
    SELECT pid, org_id, src, key,
           CASE WHEN org_key = t1 OR org_key = t2 THEN 1.0 ELSE strength END AS s
      FROM matches
     WHERE src <> 'description_email' OR org_type IN ('media','radio_station')
  ), agg AS (
    SELECT pid, org_id, max(s) AS s, array_agg(DISTINCT src ORDER BY src) AS srcs,
           jsonb_agg(DISTINCT jsonb_build_object('source', src, 'key', key)) AS ev
      FROM scored GROUP BY pid, org_id
  ), ranked AS (
    SELECT *, max(s) OVER (PARTITION BY pid) AS top,
           count(*) FILTER (WHERE true) OVER (PARTITION BY pid, s) AS n_at_s
      FROM agg
  )
  SELECT pid AS podcast_id, org_id AS organization_id,
         CASE WHEN n_at_s > 1 THEN 'ambiguous' ELSE 'accepted' END AS status,
         s AS strength, srcs AS sources, ev AS evidence
    FROM ranked WHERE s = top;

  WITH up AS (
    INSERT INTO public.podcast_publishers AS pp (podcast_id, organization_id, status, strength, sources, evidence)
    SELECT podcast_id, organization_id, status, strength, sources, evidence FROM _pp_new
    ON CONFLICT (podcast_id, organization_id) DO UPDATE
      SET status = EXCLUDED.status, strength = EXCLUDED.strength, sources = EXCLUDED.sources,
          evidence = EXCLUDED.evidence, updated_at = now()
      WHERE pp.status NOT LIKE 'manual%'
        AND (pp.status, pp.strength, pp.sources, pp.evidence) IS DISTINCT FROM (EXCLUDED.status, EXCLUDED.strength, EXCLUDED.sources, EXCLUDED.evidence)
    RETURNING 1)
  SELECT count(*) INTO v_upserted FROM up;

  WITH del AS (
    DELETE FROM public.podcast_publishers pp
     WHERE pp.status IN ('accepted','ambiguous')
       AND NOT EXISTS (SELECT 1 FROM _pp_new n WHERE n.podcast_id = pp.podcast_id AND n.organization_id = pp.organization_id)
    RETURNING 1)
  SELECT count(*) INTO v_removed FROM del;

  RETURN jsonb_build_object('upserted', v_upserted, 'removed', v_removed,
    'accepted', (SELECT count(*) FROM public.podcast_publishers WHERE status IN ('accepted','manual_accepted')),
    'ambiguous', (SELECT count(*) FROM public.podcast_publishers WHERE status = 'ambiguous'));
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_podcast_publishers_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_podcast_publishers_v1() TO service_role;

-- 5) Non-destructive, reversible organization merge (the duplicate row stays as a redirect pointer).
CREATE TABLE IF NOT EXISTS public.organization_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  src_id uuid NOT NULL,
  dst_id uuid NOT NULL,
  note text,
  src_before jsonb NOT NULL,
  dst_before jsonb NOT NULL,
  src_map_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  dropped_map_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  upgraded_dst_map_ids uuid[] NOT NULL DEFAULT '{}',
  moved_alias_ids uuid[] NOT NULL DEFAULT '{}',
  added_alias_ids uuid[] NOT NULL DEFAULT '{}',
  merged_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz
);
GRANT ALL ON public.organization_merge_log TO service_role;
ALTER TABLE public.organization_merge_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.merge_organization_into_v1(_src uuid, _dst uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s public.organizations%ROWTYPE; d public.organizations%ROWTYPE;
  v_map jsonb; v_dropped jsonb; v_upg uuid[]; v_moved uuid[]; v_added uuid[] := '{}'; v_id uuid; v_log uuid; k text;
BEGIN
  IF _src = _dst THEN RAISE EXCEPTION 'merge: src equals dst'; END IF;
  SELECT * INTO s FROM public.organizations WHERE id = _src FOR UPDATE;
  SELECT * INTO d FROM public.organizations WHERE id = _dst FOR UPDATE;
  IF s.id IS NULL OR d.id IS NULL THEN RAISE EXCEPTION 'merge: organization not found'; END IF;
  IF s.ai_duplicate_of_organization_id IS NOT NULL THEN RAISE EXCEPTION 'merge: src already merged'; END IF;
  IF d.ai_duplicate_of_organization_id IS NOT NULL THEN RAISE EXCEPTION 'merge: dst is itself a duplicate'; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO v_map FROM public.episode_organization_map m WHERE m.organization_id = _src;
  SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO v_dropped FROM public.episode_organization_map m
   WHERE m.organization_id = _src AND m.episode_id IN (SELECT episode_id FROM public.episode_organization_map WHERE organization_id = _dst);
  SELECT coalesce(array_agg(dm.id), '{}') INTO v_upg FROM public.episode_organization_map dm
    JOIN public.episode_organization_map sm ON sm.episode_id = dm.episode_id AND sm.organization_id = _src AND sm.role = 'primary'
   WHERE dm.organization_id = _dst AND dm.role <> 'primary';
  UPDATE public.episode_organization_map SET role = 'primary' WHERE id = ANY (v_upg);
  DELETE FROM public.episode_organization_map WHERE organization_id = _src
     AND episode_id IN (SELECT episode_id FROM public.episode_organization_map WHERE organization_id = _dst);
  UPDATE public.episode_organization_map SET organization_id = _dst WHERE organization_id = _src;

  SELECT coalesce(array_agg(id), '{}') INTO v_moved FROM public.organization_aliases WHERE organization_id = _src;
  UPDATE public.organization_aliases SET organization_id = _dst WHERE organization_id = _src;
  FOREACH k IN ARRAY ARRAY[s.normalized_name, public.org_name_key_v1(s.name)] LOOP
    IF k IS NOT NULL AND k <> d.normalized_name AND NOT EXISTS (SELECT 1 FROM public.organization_aliases WHERE normalized_alias = k) THEN
      INSERT INTO public.organization_aliases (organization_id, alias, normalized_alias, source, confidence, status)
      VALUES (_dst, s.name, k, 'merge_v1', 1.0, 'accepted') RETURNING id INTO v_id;
      v_added := v_added || v_id;
    END IF;
  END LOOP;

  UPDATE public.organizations SET
    wikidata_id = COALESCE(wikidata_id, s.wikidata_id),
    wikipedia_url = COALESCE(wikipedia_url, s.wikipedia_url),
    wikipedia_title = COALESCE(wikipedia_title, s.wikipedia_title),
    wikipedia_extract = COALESCE(wikipedia_extract, s.wikipedia_extract),
    logo_url = COALESCE(logo_url, s.logo_url)
  WHERE id = _dst;

  UPDATE public.organizations SET
    ai_duplicate_of_organization_id = _dst,
    normalized_name = 'merged ' || _src::text,
    is_public = false, is_indexable = false, is_browsable_in_hub = false,
    browsable_reason = 'merged_duplicate'
  WHERE id = _src;

  INSERT INTO public.organization_merge_log (src_id, dst_id, note, src_before, dst_before, src_map_rows, dropped_map_rows, upgraded_dst_map_ids, moved_alias_ids, added_alias_ids)
  VALUES (_src, _dst, _note, to_jsonb(s), to_jsonb(d), v_map, v_dropped, v_upg, v_moved, v_added)
  RETURNING id INTO v_log;

  RETURN jsonb_build_object('log_id', v_log, 'src', s.slug, 'dst', d.slug,
    'map_rows', jsonb_array_length(v_map), 'dropped_duplicates', jsonb_array_length(v_dropped), 'aliases_added', array_length(v_added, 1));
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_organization_merge_v1(_log_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l public.organization_merge_log%ROWTYPE; sb jsonb; db jsonb;
BEGIN
  SELECT * INTO l FROM public.organization_merge_log WHERE id = _log_id FOR UPDATE;
  IF l.id IS NULL OR l.undone_at IS NOT NULL THEN RAISE EXCEPTION 'undo: log missing or already undone'; END IF;
  sb := l.src_before; db := l.dst_before;
  UPDATE public.episode_organization_map SET role = 'mentioned' WHERE id = ANY (l.upgraded_dst_map_ids);
  UPDATE public.episode_organization_map m SET organization_id = l.src_id
   WHERE m.id IN (SELECT (r->>'id')::uuid FROM jsonb_array_elements(l.src_map_rows) r);
  INSERT INTO public.episode_organization_map
  SELECT (jsonb_populate_record(NULL::public.episode_organization_map, r)).* FROM jsonb_array_elements(l.dropped_map_rows) r
  ON CONFLICT (id) DO NOTHING;
  DELETE FROM public.organization_aliases WHERE id = ANY (l.added_alias_ids);
  UPDATE public.organization_aliases SET organization_id = l.src_id WHERE id = ANY (l.moved_alias_ids);
  UPDATE public.organizations SET
    wikidata_id = db->>'wikidata_id', wikipedia_url = db->>'wikipedia_url', wikipedia_title = db->>'wikipedia_title',
    wikipedia_extract = db->>'wikipedia_extract', logo_url = db->>'logo_url'
  WHERE id = l.dst_id;
  UPDATE public.organizations SET
    ai_duplicate_of_organization_id = NULLIF(sb->>'ai_duplicate_of_organization_id', '')::uuid,
    normalized_name = sb->>'normalized_name',
    is_public = (sb->>'is_public')::boolean, is_indexable = (sb->>'is_indexable')::boolean,
    is_browsable_in_hub = (sb->>'is_browsable_in_hub')::boolean, browsable_reason = sb->>'browsable_reason'
  WHERE id = l.src_id;
  UPDATE public.organization_merge_log SET undone_at = now() WHERE id = _log_id;
  RETURN jsonb_build_object('undone', _log_id);
END;
$$;
REVOKE ALL ON FUNCTION public.merge_organization_into_v1(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.undo_organization_merge_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_organization_into_v1(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.undo_organization_merge_v1(uuid) TO service_role;

-- 6) Gating: publishers are public/indexable; merged duplicates never; only real changes are written.
CREATE OR REPLACE FUNCTION public.recompute_org_gated_counts()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_radio_whitelist text[] := ARRAY['Tilos Rádió','Kossuth Rádió','Klubrádió','InfoRádió','Szabad Európa Rádió','Petőfi Rádió','Bartók Rádió','Katolikus Rádió','Magyar Rádió'];
BEGIN
  WITH counts AS (
    SELECT m.organization_id,
      COUNT(DISTINCT m.episode_id) FILTER (WHERE p.language_decision = 'accept_hungarian' AND c.episode_id IS NOT NULL) AS gated_eps,
      COUNT(DISTINCT COALESCE(m.podcast_id, e.podcast_id)) FILTER (WHERE p.language_decision = 'accept_hungarian' AND c.episode_id IS NOT NULL) AS gated_pods,
      COUNT(DISTINCT m.episode_id) AS total_eps,
      COUNT(DISTINCT COALESCE(m.podcast_id, e.podcast_id)) AS total_pods,
      COUNT(*) FILTER (WHERE m.role = 'mentioned') AS mentions,
      COUNT(*) FILTER (WHERE m.role = 'primary') AS primaries,
      MAX(c.published_at) FILTER (WHERE p.language_decision = 'accept_hungarian') AS latest_ep,
      array_agg(DISTINCT COALESCE(m.podcast_id, e.podcast_id)) AS source_pids
    FROM public.episode_organization_map m
    JOIN public.episodes e ON e.id = m.episode_id
    LEFT JOIN public.episode_cards c ON c.episode_id = m.episode_id
    LEFT JOIN public.podcasts p ON p.id = COALESCE(m.podcast_id, e.podcast_id)
    GROUP BY m.organization_id
  ), pubs AS (
    SELECT pp.organization_id, count(*) AS n FROM public.podcast_publishers pp
      JOIN public.podcasts p ON p.id = pp.podcast_id
     WHERE pp.status IN ('accepted','manual_accepted') AND p.language_decision = 'accept_hungarian'
     GROUP BY pp.organization_id
  ), calc AS (
    SELECT o.id,
      COALESCE(c.total_eps, 0) AS episode_count, COALESCE(c.gated_eps, 0) AS gated_eps,
      COALESCE(c.total_pods, 0) AS podcast_count, COALESCE(c.gated_pods, 0) AS gated_pods,
      COALESCE(array_length(c.source_pids, 1), 0) AS distinct_pods, COALESCE(c.source_pids, '{}'::uuid[]) AS source_pids,
      COALESCE(c.mentions, 0) AS mentions, COALESCE(c.primaries, 0) AS primaries, c.latest_ep,
      o.ai_duplicate_of_organization_id IS NOT NULL AS dup,
      COALESCE(pb.n, 0) > 0 AS pub,
      (o.is_podcast_internal OR (o.org_type = 'radio_station' AND NOT (o.name = ANY (v_radio_whitelist)))) AS blocked,
      o.quality_hold_at IS NOT NULL AS held,
      ((o.org_type = 'party' AND COALESCE(c.gated_eps, 0) >= 1) OR (o.wikipedia_match_status = 'verified' AND COALESCE(c.gated_eps, 0) >= 1) OR COALESCE(c.gated_eps, 0) >= 3) AS idx_base,
      (COALESCE(c.gated_eps, 0) >= 1 OR o.manually_seeded OR o.org_type = 'party') AS pub_base,
      o.is_podcast_internal, o.org_type, o.wikipedia_match_status, o.manually_seeded
    FROM public.organizations o
    LEFT JOIN counts c ON c.organization_id = o.id
    LEFT JOIN pubs pb ON pb.organization_id = o.id
  ), f AS (
    SELECT calc.*,
      (NOT dup AND (pub OR (NOT blocked AND pub_base))) AS v_public,
      (NOT dup AND NOT held AND (pub OR (NOT blocked AND idx_base))) AS v_index,
      CASE
        WHEN dup THEN 'merged_duplicate'
        WHEN pub AND held THEN 'quality_hold'
        WHEN pub THEN 'publisher'
        WHEN is_podcast_internal THEN 'podcast_internal'
        WHEN blocked THEN 'radio_publisher_noise'
        WHEN held THEN 'quality_hold'
        WHEN org_type = 'party' AND gated_eps >= 1 THEN 'party_priority'
        WHEN wikipedia_match_status = 'verified' AND gated_eps >= 1 THEN 'wikipedia_verified'
        WHEN gated_eps >= 3 THEN 'has_hu_episodes'
        WHEN gated_eps >= 1 THEN 'public_low_ep'
        WHEN manually_seeded THEN 'editorial_seed'
        ELSE 'no_eps' END AS v_reason
    FROM calc
  )
  UPDATE public.organizations o SET
    episode_count = f.episode_count, gated_episode_count = f.gated_eps,
    podcast_count = f.podcast_count, gated_podcast_count = f.gated_pods,
    distinct_podcast_count = f.distinct_pods, source_podcast_ids = f.source_pids,
    mention_count = f.mentions, primary_count = f.primaries, latest_episode_at = f.latest_ep,
    is_public = f.v_public, is_indexable = f.v_index, is_browsable_in_hub = f.v_index,
    browsable_reason = f.v_reason
  FROM f
  WHERE o.id = f.id
    AND (o.episode_count, o.gated_episode_count, o.podcast_count, o.gated_podcast_count, o.distinct_podcast_count,
         o.source_podcast_ids, o.mention_count, o.primary_count, o.latest_episode_at,
         o.is_public, o.is_indexable, o.is_browsable_in_hub, o.browsable_reason)
      IS DISTINCT FROM
        (f.episode_count, f.gated_eps, f.podcast_count, f.gated_pods, f.distinct_pods,
         f.source_pids, f.mentions, f.primaries, f.latest_ep,
         f.v_public, f.v_index, f.v_index, f.v_reason);
END;
$function$;

-- 7) A publisher's own shows are not "internal noise".
CREATE OR REPLACE FUNCTION public.demote_publisher_self_orgs()
 RETURNS TABLE(demoted_count integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_count integer;
BEGIN
  WITH org_pod AS (
    SELECT o.id AS org_id, o.episode_count, p.id AS pid, COUNT(*) AS in_pod
    FROM organizations o
    JOIN episode_organization_map m ON m.organization_id = o.id
    JOIN episodes e ON e.id = m.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE o.is_public = true AND o.wikidata_id IS NULL AND o.ai_bio IS NULL AND o.episode_count >= 5
      AND NOT EXISTS (SELECT 1 FROM podcast_publishers pp WHERE pp.organization_id = o.id AND pp.status IN ('accepted','manual_accepted'))
    GROUP BY o.id, o.episode_count, p.id
  ), top AS (
    SELECT org_id, episode_count, in_pod, ROW_NUMBER() OVER (PARTITION BY org_id ORDER BY in_pod DESC) AS rn FROM org_pod
  ), to_demote AS (
    SELECT org_id FROM top WHERE rn = 1 AND in_pod >= 5 AND in_pod::float / GREATEST(episode_count, 1) >= 0.7
  )
  UPDATE organizations o SET is_public = false, is_indexable = false, is_browsable_in_hub = false,
    is_podcast_internal = true, podcast_internal_reason = 'top_podcast_share>=0.7'
  FROM to_demote d
  WHERE o.id = d.org_id AND (o.is_public OR o.is_indexable OR o.is_browsable_in_hub OR o.is_podcast_internal = false);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$function$;

-- 8) Owner-confirmed merges (2026-10-27): telex.hu = Telex, 444.hu = 444, radio1 = Rádió 1.
SELECT public.merge_organization_into_v1((SELECT id FROM public.organizations WHERE slug = 'telex-hu'), (SELECT id FROM public.organizations WHERE slug = 'telex'), 'owner 2026-10-27: same outlet');
SELECT public.merge_organization_into_v1((SELECT id FROM public.organizations WHERE slug = '444-hu'), (SELECT id FROM public.organizations WHERE slug = '444'), 'owner 2026-10-27: same outlet');
SELECT public.merge_organization_into_v1((SELECT id FROM public.organizations WHERE slug = 'radio1'), (SELECT id FROM public.organizations WHERE slug = 'radio-1'), 'owner 2026-10-27: same station');