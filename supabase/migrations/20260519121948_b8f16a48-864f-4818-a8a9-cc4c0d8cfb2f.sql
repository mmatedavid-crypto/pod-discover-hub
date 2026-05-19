
DROP FUNCTION IF EXISTS public.match_podcast_by_name(text, integer, double precision);

CREATE OR REPLACE FUNCTION public.match_podcast_by_name(
  p_q text,
  p_max integer DEFAULT 5,
  p_threshold double precision DEFAULT 0.45
)
RETURNS TABLE(podcast_id uuid, title text, slug text, similarity real, match_type text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  qn text := public.normalize_podcast_title(p_q);
  qn_nf text;
BEGIN
  IF coalesce(qn,'') = '' THEN
    RETURN;
  END IF;
  qn_nf := btrim(regexp_replace(qn, '(^|\s)(podcast|podcasts|show|musor|epizod|epizodok|hivatalos|official)(\s|$)', ' ', 'g'));
  qn_nf := regexp_replace(qn_nf, '\s+', ' ', 'g');
  IF qn_nf = '' THEN qn_nf := qn; END IF;

  RETURN QUERY
  WITH base AS (
    SELECT p.id, p.title, p.slug, p.normalized_title, p.podiverzum_rank
    FROM public.podcasts p
    WHERE p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND coalesce(p.rss_status,'') NOT IN ('failed','inactive','blocked','dead')
      AND p.normalized_title IS NOT NULL
      AND p.normalized_title <> ''
      AND (
        p.normalized_title = qn
        OR p.normalized_title = qn_nf
        OR (' ' || p.normalized_title || ' ') LIKE ('% ' || qn_nf || ' %')
        OR p.normalized_title LIKE (qn_nf || '%')
        OR p.normalized_title LIKE ('%' || qn_nf || '%')
        OR (length(qn_nf) >= 4 AND p.normalized_title % qn_nf)
      )
  ),
  scored AS (
    SELECT b.id, b.title, b.slug, b.podiverzum_rank,
      CASE
        WHEN b.normalized_title = qn_nf OR b.normalized_title = qn THEN 1.0::real
        WHEN (' ' || b.normalized_title || ' ') LIKE ('% ' || qn_nf || ' %') THEN 0.93::real
        WHEN b.normalized_title LIKE (qn_nf || '%') THEN 0.85::real
        WHEN b.normalized_title LIKE ('%' || qn_nf || '%') THEN 0.78::real
        ELSE similarity(b.normalized_title, qn_nf)::real
      END AS sim,
      CASE
        WHEN b.normalized_title = qn_nf OR b.normalized_title = qn THEN 'exact'
        WHEN (' ' || b.normalized_title || ' ') LIKE ('% ' || qn_nf || ' %') THEN 'token'
        WHEN b.normalized_title LIKE (qn_nf || '%') THEN 'prefix'
        WHEN b.normalized_title LIKE ('%' || qn_nf || '%') THEN 'substr'
        ELSE 'trgm'
      END AS mtype
    FROM base b
  )
  SELECT s.id, s.title, s.slug, s.sim, s.mtype
  FROM scored s
  WHERE s.sim >= p_threshold
  ORDER BY s.sim DESC, coalesce(s.podiverzum_rank, 0) DESC
  LIMIT p_max;
END;
$function$;
