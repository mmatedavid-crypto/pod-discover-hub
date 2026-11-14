CREATE OR REPLACE VIEW public.person_public_episode_links_v1 AS
WITH base AS (
  SELECT m.person_id, m.episode_id, c.podcast_id, c.published_at,
    m.mention_type, m.role_type, m.relevance_status, m.validation_source, m.final_relevance_score, m.confidence,
    (m.relevance_status = 'accepted' AND btrim(COALESCE(m.validation_source, '')) <> '') AS verified,
    (m.relevance_status = 'accepted'
      OR COALESCE(m.final_relevance_score, 0) >= 0.75
      OR m.validation_source = 'manual'
      OR (COALESCE(m.relevance_status, 'pending') = 'pending'
          AND m.mention_type IN ('host','guest','subject','archival_source','interviewee','speaker')
          AND COALESCE(m.confidence, 0) >= 0.80)) AS strong
  FROM public.person_episode_mentions m
  JOIN public.episode_cards c ON c.episode_id = m.episode_id
  JOIN public.podcasts p ON p.id = c.podcast_id
  WHERE p.language_decision = 'accept_hungarian'
    -- Inherited show-host roles are series-level, not episode appearances (see person_show_host_roles_v1).
    AND COALESCE(m.relevance_status, 'pending') NOT IN ('rejected', 'needs_review', 'resolved_show_host')
), anchored AS (
  SELECT b.*, bool_or(b.verified) OVER (PARTITION BY b.person_id) AS person_anchored
  FROM base b
)
SELECT DISTINCT ON (a.person_id, a.episode_id)
  a.person_id, a.episode_id, a.podcast_id, a.published_at, a.verified,
  CASE
    WHEN NOT a.verified THEN 'mention'
    WHEN a.role_type IN ('participant','subject','mention') THEN a.role_type
    WHEN a.mention_type IN ('host','guest','interviewee','speaker','archival_source') THEN 'participant'
    WHEN a.mention_type = 'subject' THEN 'subject'
    ELSE 'mention'
  END AS page_role,
  a.mention_type, a.relevance_status, a.validation_source, a.final_relevance_score, a.confidence
FROM anchored a
WHERE a.strong AND (a.verified OR NOT a.person_anchored)
ORDER BY a.person_id, a.episode_id, a.verified DESC, a.final_relevance_score DESC NULLS LAST, a.confidence DESC;
COMMENT ON VIEW public.person_public_episode_links_v1 IS 'Single eligibility rule for a person page: episodes listed, counted, prerendered and linked. Inherited show-host roles excluded (series-level). Server-only.';
REVOKE ALL ON public.person_public_episode_links_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.person_public_episode_links_v1 TO service_role;

-- Series-level host roles per canonical person and show (display as "Műsorvezető"; never counted as appearances).
CREATE OR REPLACE VIEW public.person_show_host_roles_v1 AS
SELECT h.canonical_person_id AS person_id, h.podcast_id, 'host'::text AS role, 'inherited_show_host'::text AS provenance,
  bool_or(h.owner_confirmed) AS owner_confirmed, min(h.valid_from) AS valid_from, max(h.valid_until) AS valid_until,
  (array_agg(h.source_url ORDER BY h.rule_key))[1] AS source_url, (array_agg(h.source_quote ORDER BY h.rule_key))[1] AS source_quote,
  array_agg(h.id ORDER BY h.rule_key) AS rule_ids,
  (SELECT count(DISTINCT x.episode_id) FROM public.person_host_rule_resolutions x WHERE x.rule_id = ANY(array_agg(h.id))) AS inherited_episodes
FROM public.person_host_rules h
WHERE h.active
GROUP BY h.canonical_person_id, h.podcast_id;
COMMENT ON VIEW public.person_show_host_roles_v1 IS 'Owner/publisher-sourced show-host roles; inherited_episodes counts each episode once per canonical person (no double counting across scoped profiles). Server-only.';
REVOKE ALL ON public.person_show_host_roles_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.person_show_host_roles_v1 TO service_role;