
-- Letter counts (A-Z + '#' for other)
CREATE OR REPLACE FUNCTION public.people_alpha_letter_counts()
RETURNS TABLE(letter text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      CASE
        WHEN upper(unaccent(left(name,1))) ~ '^[A-Z]$'
          THEN upper(unaccent(left(name,1)))
        ELSE '#'
      END AS l
    FROM people
    WHERE is_public = true
      AND is_browsable_in_people_hub = true
      AND COALESCE(gated_episode_count, 0) >= 1
  )
  SELECT l AS letter, count(*)::bigint AS count
  FROM base
  GROUP BY l
  ORDER BY l;
$$;

-- Alphabetic list with optional letter filter
CREATE OR REPLACE FUNCTION public.list_people_alpha(
  p_letter text DEFAULT NULL,
  p_limit int DEFAULT 60,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  slug text,
  name text,
  disambiguation_label text,
  short_bio text,
  ai_bio text,
  gated_episode_count int,
  gated_podcast_count int,
  episode_count int,
  podcast_count int,
  latest_accepted_relevant_episode_at timestamptz,
  host_count int,
  guest_count int,
  strong_mention_count int,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION public.people_alpha_letter_counts() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_people_alpha(text, int, int) TO anon, authenticated;
