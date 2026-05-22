CREATE OR REPLACE FUNCTION public.demote_publisher_self_orgs()
RETURNS TABLE(demoted_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH org_pod AS (
    SELECT o.id AS org_id, o.episode_count,
           p.id AS pid, COUNT(*) AS in_pod
    FROM organizations o
    JOIN episode_organization_map m ON m.organization_id = o.id
    JOIN episodes e ON e.id = m.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE o.is_public = true
      AND o.wikidata_id IS NULL
      AND o.ai_bio IS NULL
      AND o.episode_count >= 5
    GROUP BY o.id, o.episode_count, p.id
  ),
  top AS (
    SELECT org_id, episode_count, in_pod,
           ROW_NUMBER() OVER (PARTITION BY org_id ORDER BY in_pod DESC) AS rn
    FROM org_pod
  ),
  to_demote AS (
    SELECT org_id FROM top
    WHERE rn = 1
      AND in_pod >= 5
      AND in_pod::float / GREATEST(episode_count, 1) >= 0.7
  )
  UPDATE organizations o
  SET is_public = false,
      is_indexable = false,
      is_browsable_in_hub = false,
      is_podcast_internal = true,
      podcast_internal_reason = 'top_podcast_share>=0.7'
  FROM to_demote d
  WHERE o.id = d.org_id
    AND (o.is_public = true OR o.is_indexable = true OR o.is_browsable_in_hub = true OR o.is_podcast_internal = false);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$$;

-- Egyszeri futtatás
SELECT * FROM public.demote_publisher_self_orgs();
SELECT public.recompute_org_gated_counts();

-- Cron: óránként szűr
SELECT cron.schedule(
  'demote-publisher-self-orgs',
  '0 * * * *',
  $$SELECT public.demote_publisher_self_orgs();$$
);