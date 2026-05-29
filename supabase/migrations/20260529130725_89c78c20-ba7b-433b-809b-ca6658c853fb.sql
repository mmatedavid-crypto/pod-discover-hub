
-- Flag organizations as podcast-internal when most of their "mentions" come
-- from podcasts whose title contains the org name (their own show network).
-- This nukes Tilos Rádió, ATV, InfoStart, etc. from the top organizations list.

WITH stats AS (
  SELECT
    o.id,
    o.name,
    COUNT(*) AS total_eps,
    COUNT(*) FILTER (
      WHERE p.title ILIKE '%' || o.name || '%'
         OR p.title ILIKE '%' || SPLIT_PART(o.name, ' ', 1) || '%'
    ) AS self_eps,
    COUNT(DISTINCT p.id) FILTER (
      WHERE p.title NOT ILIKE '%' || o.name || '%'
        AND p.title NOT ILIKE '%' || SPLIT_PART(o.name, ' ', 1) || '%'
    ) AS cross_pods
  FROM public.organizations o
  JOIN public.episode_organization_map eom ON eom.organization_id = o.id
  JOIN public.podcasts p ON p.id = eom.podcast_id
  WHERE o.org_type IN ('media','radio_station','company','institution','ngo','university','research','church')
    AND length(o.name) >= 3
  GROUP BY o.id, o.name
)
UPDATE public.organizations o
SET
  is_podcast_internal = true,
  podcast_internal_reason = 'auto_self_publisher: ' || s.self_eps || '/' || s.total_eps || ' eps from own podcasts, cross_pods=' || s.cross_pods
FROM stats s
WHERE o.id = s.id
  AND o.is_podcast_internal = false
  AND s.total_eps >= 20
  AND (
    -- 50%+ of mentions are from podcasts named after the org
    (s.self_eps::float / s.total_eps) >= 0.5
    OR
    -- fewer than 5 distinct non-self podcasts mention it
    s.cross_pods < 5
  );

-- Also explicitly mark known HU media/broadcast publishers that may not match
-- by title (different brand names on RSS feed titles).
UPDATE public.organizations
SET is_podcast_internal = true,
    podcast_internal_reason = COALESCE(podcast_internal_reason, 'manual_publisher_list')
WHERE is_podcast_internal = false
  AND name = ANY (ARRAY[
    'ATV','M1','M2','Duna TV','Duna Televízió','MTVA','Magyar Televízió',
    'Hír TV','HírTV','Pesti TV','Magyar Rádió',
    'Infostart.hu','Infostart','InfoRádió','InforRádió'
  ]);

-- Recompute gating so is_indexable / is_public / is_browsable flip off.
SELECT public.recompute_org_gated_counts();
