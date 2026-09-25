CREATE OR REPLACE FUNCTION public.recompute_person_gated_counts()
 RETURNS TABLE(updated_count integer, single_ep_count integer, zero_ep_count integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_updated integer := 0; v_single integer := 0; v_zero integer := 0;
BEGIN
  -- Canonical rule: only publicly visible (episode_cards) episodes of accepted-Hungarian
  -- podcasts, via accepted links. Same rule as the person page episode list.
  WITH gated AS (
    SELECT pem.person_id,
      COUNT(DISTINCT c.episode_id)::int AS ep_count,
      COUNT(DISTINCT c.podcast_id)::int AS pod_count,
      MAX(c.published_at) AS latest_ep
    FROM public.person_episode_mentions pem
    JOIN public.episode_cards c ON c.episode_id = pem.episode_id
    JOIN public.podcasts p ON p.id = c.podcast_id
    WHERE p.language_decision = 'accept_hungarian'
      AND COALESCE(pem.relevance_status, 'pending') NOT IN ('rejected','needs_review')
      AND (
        pem.relevance_status = 'accepted'
        OR COALESCE(pem.final_relevance_score, 0) >= 0.75
        OR pem.validation_source = 'manual'
        OR (COALESCE(pem.relevance_status, 'pending') = 'pending'
            AND pem.mention_type IN ('host','guest','subject','archival_source','interviewee','speaker')
            AND COALESCE(pem.confidence, 0) >= 0.80)
      )
    GROUP BY pem.person_id
  ),
  joined AS (
    SELECT pp2.id,
           COALESCE(g2.ep_count, 0) AS ep_count,
           COALESCE(g2.pod_count, 0) AS pod_count,
           g2.latest_ep,
           (COALESCE(pp2.ai_recommended_action,'') NOT IN ('hide','reject')
            AND COALESCE(pp2.ai_review_status,'') NOT IN ('needs_human_review','duplicate_candidate')
            AND COALESCE(pp2.identity_status,'') NOT IN ('split_resolved')) AS not_hard_blocked
    FROM public.people pp2
    LEFT JOIN gated g2 ON g2.person_id = pp2.id
  ),
  upd AS (
    UPDATE public.people pp
    SET
      gated_episode_count = j.ep_count,
      gated_podcast_count = j.pod_count,
      latest_episode_at = j.latest_ep,
      is_public = CASE WHEN j.ep_count = 0 THEN false WHEN j.not_hard_blocked THEN true ELSE pp.is_public END,
      is_indexable = CASE WHEN j.ep_count = 0 THEN false WHEN j.not_hard_blocked THEN true ELSE pp.is_indexable END,
      is_browsable_in_people_hub = CASE WHEN j.ep_count = 0 THEN false WHEN j.not_hard_blocked THEN true ELSE pp.is_browsable_in_people_hub END,
      activation_status = CASE WHEN j.ep_count = 0 THEN 'inactive' WHEN j.not_hard_blocked THEN 'active' ELSE pp.activation_status END,
      updated_at = now()
    FROM joined j
    WHERE pp.id = j.id
      AND (
        pp.gated_episode_count IS DISTINCT FROM j.ep_count
        OR pp.gated_podcast_count IS DISTINCT FROM j.pod_count
        OR pp.latest_episode_at IS DISTINCT FROM j.latest_ep
        OR (j.ep_count = 0 AND (pp.is_public OR pp.is_indexable OR pp.is_browsable_in_people_hub))
        OR (j.ep_count >= 1 AND j.not_hard_blocked AND (
              NOT pp.is_public OR NOT pp.is_indexable OR NOT pp.is_browsable_in_people_hub
              OR COALESCE(pp.activation_status,'') <> 'active'))
      )
    RETURNING pp.id, j.ep_count AS ec
  )
  SELECT COUNT(*)::int, COUNT(*) FILTER (WHERE ec = 1)::int, COUNT(*) FILTER (WHERE ec = 0)::int
  INTO v_updated, v_single, v_zero FROM upd;
  RETURN QUERY SELECT v_updated, v_single, v_zero;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_org_gated_counts()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_radio_whitelist text[] := ARRAY[
    'Tilos Rádió','Kossuth Rádió','Klubrádió','InfoRádió','Szabad Európa Rádió',
    'Petőfi Rádió','Bartók Rádió','Katolikus Rádió','Magyar Rádió'
  ];
BEGIN
  -- Canonical rule: gated counts + latest date come only from publicly visible
  -- (episode_cards) episodes of accepted-Hungarian podcasts. Every org is updated,
  -- including ones that lost all links (previously they kept stale public state).
  WITH counts AS (
    SELECT
      m.organization_id,
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
  ),
  j AS (
    SELECT o2.id, c.* FROM public.organizations o2 LEFT JOIN counts c ON c.organization_id = o2.id
  )
  UPDATE public.organizations o
  SET
    episode_count = COALESCE(j.total_eps, 0),
    gated_episode_count = COALESCE(j.gated_eps, 0),
    podcast_count = COALESCE(j.total_pods, 0),
    gated_podcast_count = COALESCE(j.gated_pods, 0),
    distinct_podcast_count = COALESCE(array_length(j.source_pids, 1), 0),
    source_podcast_ids = COALESCE(j.source_pids, '{}'::uuid[]),
    mention_count = COALESCE(j.mentions, 0),
    primary_count = COALESCE(j.primaries, 0),
    latest_episode_at = j.latest_ep,
    is_public = CASE
      WHEN o.is_podcast_internal THEN false
      WHEN o.org_type = 'radio_station' AND NOT (o.name = ANY (v_radio_whitelist)) THEN false
      WHEN COALESCE(j.gated_eps, 0) >= 1 OR o.manually_seeded OR o.org_type = 'party' THEN true
      ELSE false END,
    is_indexable = CASE
      WHEN o.is_podcast_internal THEN false
      WHEN o.org_type = 'radio_station' AND NOT (o.name = ANY (v_radio_whitelist)) THEN false
      WHEN o.org_type = 'party' AND COALESCE(j.gated_eps, 0) >= 1 THEN true
      WHEN o.wikipedia_match_status = 'verified' AND COALESCE(j.gated_eps, 0) >= 1 THEN true
      WHEN COALESCE(j.gated_eps, 0) >= 3 THEN true
      ELSE false END,
    is_browsable_in_hub = CASE
      WHEN o.is_podcast_internal THEN false
      WHEN o.org_type = 'radio_station' AND NOT (o.name = ANY (v_radio_whitelist)) THEN false
      WHEN o.org_type = 'party' AND COALESCE(j.gated_eps, 0) >= 1 THEN true
      WHEN o.wikipedia_match_status = 'verified' AND COALESCE(j.gated_eps, 0) >= 1 THEN true
      WHEN COALESCE(j.gated_eps, 0) >= 3 THEN true
      ELSE false END,
    browsable_reason = CASE
      WHEN o.is_podcast_internal THEN 'podcast_internal'
      WHEN o.org_type = 'radio_station' AND NOT (o.name = ANY (v_radio_whitelist)) THEN 'radio_publisher_noise'
      WHEN o.org_type = 'party' AND COALESCE(j.gated_eps, 0) >= 1 THEN 'party_priority'
      WHEN o.wikipedia_match_status = 'verified' AND COALESCE(j.gated_eps, 0) >= 1 THEN 'wikipedia_verified'
      WHEN COALESCE(j.gated_eps, 0) >= 3 THEN 'has_hu_episodes'
      WHEN COALESCE(j.gated_eps, 0) >= 1 THEN 'public_low_ep'
      WHEN o.manually_seeded THEN 'editorial_seed'
      ELSE 'no_eps' END,
    updated_at = now()
  FROM j
  WHERE o.id = j.id
    AND (o.gated_episode_count IS DISTINCT FROM COALESCE(j.gated_eps,0)
      OR o.episode_count IS DISTINCT FROM COALESCE(j.total_eps,0)
      OR o.latest_episode_at IS DISTINCT FROM j.latest_ep
      OR o.is_public IS DISTINCT FROM (NOT o.is_podcast_internal AND NOT (o.org_type='radio_station' AND NOT (o.name = ANY (v_radio_whitelist))) AND (COALESCE(j.gated_eps,0) >= 1 OR o.manually_seeded OR o.org_type='party'))
      OR o.is_indexable OR o.is_browsable_in_hub);
END;
$function$;