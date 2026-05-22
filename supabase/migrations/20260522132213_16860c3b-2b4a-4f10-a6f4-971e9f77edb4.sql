DROP FUNCTION IF EXISTS public.list_people_hub(integer, integer, text);

CREATE OR REPLACE FUNCTION public.list_people_hub(p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, slug text, name text, disambiguation_label text, short_bio text, ai_bio text, image_url text, episode_count integer, podcast_count integer, distinct_podcast_count integer, gated_episode_count integer, gated_podcast_count integer, host_count integer, guest_count integer, strong_mention_count integer, recent_relevant_episode_count_30d integer, latest_accepted_relevant_episode_at timestamp with time zone, people_hub_score numeric, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT *
    FROM public.people p
    WHERE p.is_browsable_in_people_hub = true
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
    b.episode_count, b.podcast_count, b.distinct_podcast_count,
    b.gated_episode_count, b.gated_podcast_count,
    b.host_count, b.guest_count, b.strong_mention_count,
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
 RETURNS TABLE(id uuid, slug text, name text, disambiguation_label text, short_bio text, ai_bio text, image_url text, gated_episode_count integer, gated_podcast_count integer, episode_count integer, podcast_count integer, latest_accepted_relevant_episode_at timestamp with time zone, host_count integer, guest_count integer, strong_mention_count integer, total_count bigint)
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