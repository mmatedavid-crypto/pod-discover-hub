-- Recompute people.episode_count / podcast_count / latest_episode_at
-- restricted to currently accepted Hungarian podcasts. Demote those that
-- have no remaining episodes.
WITH actual AS (
  SELECT pem.person_id,
         count(DISTINCT pem.episode_id) AS real_eps,
         count(DISTINCT e.podcast_id)   AS real_pods,
         max(e.published_at)            AS latest
  FROM person_episode_mentions pem
  JOIN episodes e  ON e.id = pem.episode_id
  JOIN podcasts p  ON p.id = e.podcast_id
  WHERE p.language ILIKE 'hu%'
    AND p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
  GROUP BY pem.person_id
)
UPDATE people pe
SET episode_count      = COALESCE(a.real_eps, 0),
    podcast_count      = COALESCE(a.real_pods, 0),
    latest_episode_at  = a.latest,
    is_public          = CASE WHEN COALESCE(a.real_eps,0) = 0 THEN false ELSE pe.is_public END,
    is_indexable       = CASE WHEN COALESCE(a.real_eps,0) = 0 THEN false ELSE pe.is_indexable END,
    activation_status  = CASE WHEN COALESCE(a.real_eps,0) = 0 THEN 'inactive' ELSE pe.activation_status END,
    activation_reason  = CASE WHEN COALESCE(a.real_eps,0) = 0 THEN 'hu_recheck_no_episodes' ELSE pe.activation_reason END,
    updated_at         = now()
FROM (SELECT id FROM people) ids
LEFT JOIN actual a ON a.person_id = ids.id
WHERE pe.id = ids.id
  AND (
        pe.episode_count IS DISTINCT FROM COALESCE(a.real_eps, 0)
     OR pe.podcast_count IS DISTINCT FROM COALESCE(a.real_pods, 0)
     OR pe.latest_episode_at IS DISTINCT FROM a.latest
     OR (COALESCE(a.real_eps,0) = 0 AND (pe.is_public = true OR pe.is_indexable = true OR pe.activation_status <> 'inactive'))
  );