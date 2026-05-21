-- Expand org_type allowed values
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_org_type_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_org_type_check
  CHECK (org_type IN (
    'company','party','institution','media','ngo',
    'sport_team','sport_league','church','university','research','radio_station','other'
  ));

-- New fields for credit/sponsor filtering
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_podcast_internal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS podcast_internal_reason text,
  ADD COLUMN IF NOT EXISTS source_podcast_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS distinct_podcast_count integer NOT NULL DEFAULT 0;

-- Update recompute RPC to honor is_podcast_internal
CREATE OR REPLACE FUNCTION public.recompute_org_gated_counts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH counts AS (
    SELECT
      m.organization_id,
      COUNT(DISTINCT m.episode_id) FILTER (WHERE p.is_hungarian = true) AS gated_eps,
      COUNT(DISTINCT m.podcast_id) FILTER (WHERE p.is_hungarian = true) AS gated_pods,
      COUNT(DISTINCT m.episode_id) AS total_eps,
      COUNT(DISTINCT m.podcast_id) AS total_pods,
      COUNT(*) FILTER (WHERE m.role = 'mentioned') AS mentions,
      COUNT(*) FILTER (WHERE m.role = 'primary') AS primaries,
      MAX(e.published_at) FILTER (WHERE p.is_hungarian = true) AS latest_ep,
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
      WHEN COALESCE(c.gated_eps, 0) >= 1 OR o.manually_seeded THEN true
      ELSE false
    END,
    is_indexable = CASE
      WHEN o.is_podcast_internal THEN false
      WHEN COALESCE(c.gated_eps, 0) >= 1 THEN true
      ELSE false
    END,
    is_browsable_in_hub = CASE
      WHEN o.is_podcast_internal THEN false
      WHEN COALESCE(c.gated_eps, 0) >= 1 THEN true
      ELSE false
    END,
    browsable_reason = CASE
      WHEN o.is_podcast_internal THEN 'podcast_internal'
      WHEN COALESCE(c.gated_eps, 0) >= 1 THEN 'has_hu_episodes'
      WHEN o.manually_seeded THEN 'editorial_seed'
      ELSE 'no_eps'
    END,
    updated_at = now()
  FROM counts c
  WHERE o.id = c.organization_id;

  UPDATE public.organizations o
  SET episode_count = 0, gated_episode_count = 0, podcast_count = 0, gated_podcast_count = 0,
      distinct_podcast_count = 0,
      mention_count = 0, primary_count = 0,
      is_public = (NOT o.is_podcast_internal) AND o.manually_seeded,
      is_indexable = false,
      is_browsable_in_hub = false,
      browsable_reason = CASE
        WHEN o.is_podcast_internal THEN 'podcast_internal'
        WHEN o.manually_seeded THEN 'editorial_seed'
        ELSE 'no_eps'
      END,
      updated_at = now()
  WHERE NOT EXISTS (SELECT 1 FROM public.episode_organization_map m WHERE m.organization_id = o.id);
END;
$$;

-- Wipe the premature seed and start clean
DELETE FROM public.organization_aliases;
DELETE FROM public.organizations;