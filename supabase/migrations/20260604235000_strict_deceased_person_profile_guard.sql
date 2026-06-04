-- Deceased/historical entities can be episode subjects, but they must not be
-- presented as ordinary podcast-person profiles. Mentions or inferred
-- participant counters are not enough to override a death date.

WITH demoted AS (
  UPDATE public.people p
  SET
    is_public = false,
    is_indexable = false,
    is_browsable_in_people_hub = false,
    activation_status = 'inactive',
    ai_recommended_action = 'hide',
    browsable_reason = 'strict_deceased_person_guard_v2',
    editorial_notes = concat_ws(
      E'\n',
      nullif(p.editorial_notes, ''),
      'strict_deceased_person_guard_v2: hidden because deceased/historical entities are not podcast-person profiles without explicit archival/editorial approval.'
    ),
    updated_at = now()
  WHERE COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
    AND (
      p.is_deceased IS TRUE
      OR p.is_historical IS TRUE
      OR p.persona = 'historical'
      OR (
        (p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
        AND (
          (p.wikipedia_match_status = 'verified' AND COALESCE(p.wikipedia_match_confidence, 0) >= 0.8)
          OR COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0) = 0
        )
      )
    )
    AND (p.is_public IS TRUE OR p.is_indexable IS TRUE OR p.is_browsable_in_people_hub IS TRUE)
  RETURNING p.id
)
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'temporal_person_public_guard_policy',
  jsonb_build_object(
    'version', 2,
    'demoted_count', (SELECT count(*) FROM demoted),
    'rule', 'Deceased, date_of_death or historical people are not public/indexable podcast-person profiles without manual_approved or has_archival_evidence.',
    'death_date_guard', 'date_of_death/is_living=false demotes without archival/editorial approval when the external identity is verified or there is no host/guest/participant evidence; this avoids hiding living podcasters with bad placeholder death dates.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

DROP FUNCTION IF EXISTS public.list_people_hub(integer, integer, text);

CREATE OR REPLACE FUNCTION public.list_people_hub(p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text)
 RETURNS TABLE(
  id uuid, slug text, name text, disambiguation_label text, short_bio text, ai_bio text, image_url text,
  identity_ambiguous boolean, manual_approved boolean, ai_bio_status text, ai_bio_confidence numeric,
  wikipedia_match_status text, wikipedia_match_confidence numeric,
  episode_count integer, podcast_count integer, distinct_podcast_count integer,
  gated_episode_count integer, gated_podcast_count integer, host_count integer, guest_count integer,
  strong_mention_count integer, recent_relevant_episode_count_30d integer,
  latest_accepted_relevant_episode_at timestamp with time zone, people_hub_score numeric, total_count bigint
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT *
    FROM public.people p
    WHERE p.is_browsable_in_people_hub = true
      AND NOT (
        COALESCE(p.manual_approved, false) = false
        AND COALESCE(p.has_archival_evidence, false) = false
        AND (
          p.is_deceased IS TRUE
          OR p.is_historical IS TRUE
          OR p.persona = 'historical'
          OR (
            (p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
            AND (
              (p.wikipedia_match_status = 'verified' AND COALESCE(p.wikipedia_match_confidence, 0) >= 0.8)
              OR COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0) = 0
            )
          )
        )
      )
      AND (
        p_search IS NULL
        OR length(trim(p_search)) < 2
        OR p.normalized_name ILIKE '%' || lower(trim(p_search)) || '%'
        OR p.name ILIKE '%' || trim(p_search) || '%'
      )
  ),
  counted AS (
    SELECT COUNT(*)::bigint AS tc FROM base
  )
  SELECT
    b.id, b.slug, b.name, b.disambiguation_label, b.short_bio, b.ai_bio, b.image_url,
    b.identity_ambiguous, b.manual_approved, b.ai_bio_status, b.ai_bio_confidence,
    b.wikipedia_match_status, b.wikipedia_match_confidence,
    b.episode_count, b.podcast_count, b.distinct_podcast_count,
    b.gated_episode_count, b.gated_podcast_count, b.host_count, b.guest_count,
    b.strong_mention_count,
    b.recent_relevant_episode_count_30d,
    b.latest_accepted_relevant_episode_at,
    b.people_hub_score,
    c.tc AS total_count
  FROM base b CROSS JOIN counted c
  ORDER BY b.people_hub_score DESC NULLS LAST, b.gated_episode_count DESC, b.name ASC
  LIMIT GREATEST(LEAST(p_limit, 200), 1)
  OFFSET GREATEST(p_offset, 0);
$function$;

DROP FUNCTION IF EXISTS public.list_people_alpha(text, integer, integer);

CREATE OR REPLACE FUNCTION public.list_people_alpha(p_letter text DEFAULT NULL::text, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0)
 RETURNS TABLE(
  id uuid, slug text, name text, disambiguation_label text, short_bio text, ai_bio text, image_url text,
  identity_ambiguous boolean, manual_approved boolean, ai_bio_status text, ai_bio_confidence numeric,
  wikipedia_match_status text, wikipedia_match_confidence numeric,
  gated_episode_count integer, gated_podcast_count integer, episode_count integer, podcast_count integer,
  latest_accepted_relevant_episode_at timestamp with time zone, host_count integer, guest_count integer,
  strong_mention_count integer, total_count bigint
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH filtered AS (
    SELECT *
    FROM people p
    WHERE p.is_public = true
      AND p.is_browsable_in_people_hub = true
      AND COALESCE(p.gated_episode_count, 0) >= 1
      AND NOT (
        COALESCE(p.manual_approved, false) = false
        AND COALESCE(p.has_archival_evidence, false) = false
        AND (
          p.is_deceased IS TRUE
          OR p.is_historical IS TRUE
          OR p.persona = 'historical'
          OR (
            (p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
            AND (
              (p.wikipedia_match_status = 'verified' AND COALESCE(p.wikipedia_match_confidence, 0) >= 0.8)
              OR COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0) = 0
            )
          )
        )
      )
      AND (
        p_letter IS NULL
        OR (
          p_letter = '#'
          AND NOT (upper(unaccent(left(p.name,1))) ~ '^[A-Z]$')
        )
        OR upper(unaccent(left(p.name,1))) = upper(p_letter)
      )
  ),
  counted AS (
    SELECT count(*)::bigint AS total FROM filtered
  )
  SELECT
    f.id,
    f.slug,
    f.name,
    f.disambiguation_label,
    f.short_bio,
    f.ai_bio,
    f.image_url,
    f.identity_ambiguous,
    f.manual_approved,
    f.ai_bio_status,
    f.ai_bio_confidence,
    f.wikipedia_match_status,
    f.wikipedia_match_confidence,
    f.gated_episode_count,
    f.gated_podcast_count,
    f.episode_count,
    f.podcast_count,
    f.latest_accepted_relevant_episode_at,
    f.host_count,
    f.guest_count,
    f.strong_mention_count,
    c.total AS total_count
  FROM filtered f, counted c
  ORDER BY unaccent(f.name) ASC, f.name ASC
  LIMIT p_limit OFFSET p_offset;
$function$;

GRANT EXECUTE ON FUNCTION public.list_people_hub(integer, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_people_alpha(text, integer, integer) TO anon, authenticated;
