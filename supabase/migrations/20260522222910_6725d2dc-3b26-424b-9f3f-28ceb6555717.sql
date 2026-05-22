-- 1) Frissített gating fn: tier-aware + radio whitelist + party/verified override
CREATE OR REPLACE FUNCTION public.recompute_org_gated_counts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_radio_whitelist text[] := ARRAY[
    'Tilos Rádió','Kossuth Rádió','Klubrádió','InfoRádió','Szabad Európa Rádió',
    'Petőfi Rádió','Bartók Rádió','Katolikus Rádió','Magyar Rádió'
  ];
BEGIN
  WITH counts AS (
    SELECT
      m.organization_id,
      COUNT(DISTINCT m.episode_id) FILTER (WHERE p.language ILIKE 'hu%') AS gated_eps,
      COUNT(DISTINCT m.podcast_id) FILTER (WHERE p.language ILIKE 'hu%') AS gated_pods,
      COUNT(DISTINCT m.episode_id) AS total_eps,
      COUNT(DISTINCT m.podcast_id) AS total_pods,
      COUNT(*) FILTER (WHERE m.role = 'mentioned') AS mentions,
      COUNT(*) FILTER (WHERE m.role = 'primary') AS primaries,
      MAX(e.published_at) FILTER (WHERE p.language ILIKE 'hu%') AS latest_ep,
      array_agg(DISTINCT COALESCE(m.podcast_id, e.podcast_id)) AS source_pids
    FROM public.episode_organization_map m
    JOIN public.episodes e ON e.id = m.episode_id
    LEFT JOIN public.podcasts p ON p.id = COALESCE(m.podcast_id, e.podcast_id)
    GROUP BY m.organization_id
  )
  UPDATE public.organizations o
  SET
    episode_count = COALESCE(c.total_eps, 0),
    gated_episode_count = COALESCE(c.gated_eps, 0),
    podcast_count = COALESCE(c.total_pods, 0),
    gated_podcast_count = COALESCE(c.gated_pods, 0),
    distinct_podcast_count = COALESCE(array_length(c.source_pids, 1), 0),
    source_podcast_ids = COALESCE(c.source_pids, '{}'::uuid[]),
    mention_count = COALESCE(c.mentions, 0),
    primary_count = COALESCE(c.primaries, 0),
    latest_episode_at = c.latest_ep,
    is_public = CASE
      WHEN o.is_podcast_internal THEN false
      WHEN o.org_type = 'radio_station' AND NOT (o.name = ANY (v_radio_whitelist)) THEN false
      WHEN COALESCE(c.gated_eps, 0) >= 1 OR o.manually_seeded OR o.org_type = 'party' THEN true
      ELSE false
    END,
    is_indexable = CASE
      WHEN o.is_podcast_internal THEN false
      WHEN o.org_type = 'radio_station' AND NOT (o.name = ANY (v_radio_whitelist)) THEN false
      WHEN o.org_type = 'party' AND COALESCE(c.gated_eps, 0) >= 1 THEN true
      WHEN o.wikipedia_match_status = 'verified' AND COALESCE(c.gated_eps, 0) >= 1 THEN true
      WHEN COALESCE(c.gated_eps, 0) >= 3 THEN true
      ELSE false
    END,
    is_browsable_in_hub = CASE
      WHEN o.is_podcast_internal THEN false
      WHEN o.org_type = 'radio_station' AND NOT (o.name = ANY (v_radio_whitelist)) THEN false
      WHEN o.org_type = 'party' AND COALESCE(c.gated_eps, 0) >= 1 THEN true
      WHEN o.wikipedia_match_status = 'verified' AND COALESCE(c.gated_eps, 0) >= 1 THEN true
      WHEN COALESCE(c.gated_eps, 0) >= 3 THEN true
      ELSE false
    END,
    browsable_reason = CASE
      WHEN o.is_podcast_internal THEN 'podcast_internal'
      WHEN o.org_type = 'radio_station' AND NOT (o.name = ANY (v_radio_whitelist)) THEN 'radio_publisher_noise'
      WHEN o.org_type = 'party' AND COALESCE(c.gated_eps, 0) >= 1 THEN 'party_priority'
      WHEN o.wikipedia_match_status = 'verified' AND COALESCE(c.gated_eps, 0) >= 1 THEN 'wikipedia_verified'
      WHEN COALESCE(c.gated_eps, 0) >= 3 THEN 'has_hu_episodes'
      WHEN COALESCE(c.gated_eps, 0) >= 1 THEN 'public_low_ep'
      WHEN o.manually_seeded THEN 'editorial_seed'
      ELSE 'no_eps'
    END,
    updated_at = now()
  FROM counts c
  WHERE o.id = c.organization_id;
END;
$function$;

-- 2) Egyszeri lefuttatás
SELECT public.recompute_org_gated_counts();

-- 3) Search helper: gyors név/alias match indexable orgokra
CREATE OR REPLACE FUNCTION public.match_org_by_name(p_query text, p_limit int DEFAULT 5)
RETURNS TABLE (
  id uuid,
  slug text,
  name text,
  org_type text,
  gated_episode_count integer,
  wikipedia_match_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH q AS (
    SELECT lower(trim(p_query)) AS qn
  ),
  hits AS (
    SELECT o.id, o.slug, o.name, o.org_type, o.gated_episode_count, o.wikipedia_match_status,
           CASE
             WHEN lower(o.name) = (SELECT qn FROM q) THEN 100
             WHEN lower(o.normalized_name) = (SELECT qn FROM q) THEN 95
             WHEN lower(o.name) LIKE (SELECT qn FROM q) || '%' THEN 80
             WHEN lower(o.name) LIKE '%' || (SELECT qn FROM q) || '%' THEN 60
             ELSE 0
           END AS score
    FROM public.organizations o
    WHERE o.is_indexable = true
      AND (
        lower(o.name) LIKE '%' || (SELECT qn FROM q) || '%'
        OR lower(o.normalized_name) LIKE '%' || (SELECT qn FROM q) || '%'
      )
    UNION ALL
    SELECT o.id, o.slug, o.name, o.org_type, o.gated_episode_count, o.wikipedia_match_status,
           CASE
             WHEN lower(a.alias) = (SELECT qn FROM q) THEN 90
             WHEN lower(a.normalized_alias) = (SELECT qn FROM q) THEN 88
             ELSE 50
           END AS score
    FROM public.organization_aliases a
    JOIN public.organizations o ON o.id = a.organization_id
    WHERE o.is_indexable = true
      AND a.status = 'accepted'
      AND (
        lower(a.alias) LIKE '%' || (SELECT qn FROM q) || '%'
        OR lower(a.normalized_alias) LIKE '%' || (SELECT qn FROM q) || '%'
      )
  )
  SELECT DISTINCT ON (id) id, slug, name, org_type, gated_episode_count, wikipedia_match_status
  FROM hits
  ORDER BY id, score DESC
  LIMIT GREATEST(p_limit, 1);
$$;