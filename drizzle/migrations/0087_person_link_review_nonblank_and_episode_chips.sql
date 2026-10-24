-- A review record means a non-blank validation_source (same rule as _shared/person-link-trust.ts).
-- Adds the per-person "verified somewhere" anchor and a batched per-episode person-chip resolver.

CREATE OR REPLACE FUNCTION public.person_review_recorded_v1(p_validation_source text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(btrim(coalesce(p_validation_source, '')), '') IS NOT NULL $$;

CREATE OR REPLACE FUNCTION public.person_link_trusted_v1(p_person_id uuid, p_validation_source text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.person_review_recorded_v1(p_validation_source) AND EXISTS (
    SELECT 1 FROM public.people p
     WHERE p.id = p_person_id
       AND p.is_public IS TRUE
       AND coalesce(p.identity_status, 'normal') IN ('normal', 'confirmed', 'context_resolved')
       AND coalesce(p.ai_review_status, '') NOT IN ('needs_human_review', 'duplicate_candidate')
       AND coalesce(p.ai_recommended_action, '') NOT IN ('hide', 'reject')
       AND coalesce(p.activation_status, '') NOT IN ('inactive', 'hidden', 'rejected')
       AND NOT (coalesce(p.identity_ambiguous, false) AND NOT coalesce(p.manual_approved, false)));
$$;

-- Does this person have an accepted, reviewed link on any episode (optionally other than one)?
CREATE OR REPLACE FUNCTION public.person_has_verified_link_v1(p_person_id uuid, p_except_episode_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.person_episode_mentions a
                  WHERE a.person_id = p_person_id
                    AND a.relevance_status = 'accepted'
                    AND public.person_review_recorded_v1(a.validation_source)
                    AND (p_except_episode_id IS NULL OR a.episode_id <> p_except_episode_id));
$$;

CREATE OR REPLACE FUNCTION public.verified_person_overlap_v1(p_source_person_ids uuid[], p_episode_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN coalesce(cardinality(p_source_person_ids), 0) = 0 THEN 0 ELSE (
    SELECT count(DISTINCT m.person_id)::int
      FROM public.person_episode_mentions m
     WHERE m.episode_id = p_episode_id
       AND m.person_id = ANY(p_source_person_ids)
       AND m.relevance_status = 'accepted'
       AND public.person_review_recorded_v1(m.validation_source)) END;
$$;

CREATE OR REPLACE FUNCTION public.get_shared_verified_people_v1(p_episode_id uuid, p_candidate_ids uuid[] DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS TABLE(episode_id uuid, person_id uuid, person_name text, person_slug text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '5s' AS $$
  WITH src AS (SELECT unnest(public.verified_episode_person_ids_v1(p_episode_id)) AS pid)
  SELECT m.episode_id, m.person_id, p.name, p.slug
    FROM public.person_episode_mentions m
    JOIN src ON src.pid = m.person_id
    JOIN public.people p ON p.id = m.person_id
    JOIN public.episodes e ON e.id = m.episode_id
    JOIN public.podcasts pod ON pod.id = e.podcast_id
   WHERE m.episode_id <> p_episode_id
     AND m.relevance_status = 'accepted'
     AND public.person_review_recorded_v1(m.validation_source)
     AND (p_candidate_ids IS NULL OR m.episode_id = ANY(p_candidate_ids))
     AND pod.language_decision = 'accept_hungarian'
     AND e.audio_url IS NOT NULL
   ORDER BY e.published_at DESC NULLS LAST
   LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
$$;

CREATE OR REPLACE FUNCTION public.get_episode_person_links_v1(p_episode_id uuid)
RETURNS TABLE(person_id uuid, verified boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '5s' AS $$
  SELECT x.person_id, x.verified FROM (
    SELECT m.person_id,
           bool_or(m.relevance_status = 'accepted' AND public.person_link_trusted_v1(m.person_id, m.validation_source)) AS verified
      FROM public.person_episode_mentions m
     WHERE m.episode_id = p_episode_id
       AND coalesce(m.relevance_status, 'pending') NOT IN ('rejected', 'needs_review')
     GROUP BY m.person_id) x
   WHERE x.verified OR NOT public.person_has_verified_link_v1(x.person_id, p_episode_id)
   LIMIT 40;
$$;

-- Batched per-episode person chips (one call per page batch): slugs of people that may be
-- linked from each episode card — same episode gate as get_episode_person_links_v1 plus the
-- public-page gate of get_linkable_entities.
CREATE OR REPLACE FUNCTION public.get_linkable_episode_people_v1(p_episode_ids uuid[])
RETURNS TABLE(episode_id uuid, slug text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '5s' AS $$
  WITH m AS (
    SELECT m.episode_id, m.person_id,
           bool_or(m.relevance_status = 'accepted' AND public.person_link_trusted_v1(m.person_id, m.validation_source)) AS verified
      FROM public.person_episode_mentions m
     WHERE m.episode_id = ANY((coalesce(p_episode_ids, '{}'::uuid[]))[1:200])
       AND coalesce(m.relevance_status, 'pending') NOT IN ('rejected', 'needs_review')
     GROUP BY m.episode_id, m.person_id)
  SELECT m.episode_id, p.slug
    FROM m JOIN public.people p ON p.id = m.person_id
   WHERE (m.verified OR NOT public.person_has_verified_link_v1(m.person_id, m.episode_id))
     AND p.slug IS NOT NULL
     AND p.is_public IS TRUE
     AND p.gated_episode_count >= 1
     AND coalesce(p.activation_status, '') <> 'inactive'
     AND coalesce(p.ai_recommended_action, '') NOT IN ('hide', 'reject')
     AND coalesce(p.ai_review_status, '') NOT IN ('needs_human_review', 'duplicate_candidate')
     AND coalesce(p.identity_status, '') <> 'split_resolved';
$$;

GRANT EXECUTE ON FUNCTION public.person_review_recorded_v1(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.person_has_verified_link_v1(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_linkable_episode_people_v1(uuid[]) TO anon, authenticated, service_role;