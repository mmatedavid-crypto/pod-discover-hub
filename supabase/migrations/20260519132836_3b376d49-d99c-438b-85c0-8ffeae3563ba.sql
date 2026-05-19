-- 1. podcast_aliases table
CREATE TABLE IF NOT EXISTS public.podcast_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  confidence numeric NOT NULL DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (podcast_id, normalized_alias)
);
CREATE INDEX IF NOT EXISTS idx_podcast_aliases_norm ON public.podcast_aliases(normalized_alias);
CREATE INDEX IF NOT EXISTS idx_podcast_aliases_norm_trgm ON public.podcast_aliases USING gin (normalized_alias gin_trgm_ops);

ALTER TABLE public.podcast_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "podcast_aliases public read" ON public.podcast_aliases;
CREATE POLICY "podcast_aliases public read" ON public.podcast_aliases FOR SELECT USING (true);
DROP POLICY IF EXISTS "podcast_aliases admin write" ON public.podcast_aliases;
CREATE POLICY "podcast_aliases admin write" ON public.podcast_aliases FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 2. Trigger to auto-normalize alias on write (reuses normalize_podcast_title)
CREATE OR REPLACE FUNCTION public.podcast_aliases_normalize_tg() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.normalized_alias := public.normalize_podcast_title(NEW.alias);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS podcast_aliases_normalize ON public.podcast_aliases;
CREATE TRIGGER podcast_aliases_normalize BEFORE INSERT OR UPDATE OF alias
  ON public.podcast_aliases FOR EACH ROW EXECUTE FUNCTION public.podcast_aliases_normalize_tg();

-- 3. Re-create match_podcast_by_name with alias support + rank-label tiebreak
CREATE OR REPLACE FUNCTION public.match_podcast_by_name(p_q text, p_max integer DEFAULT 5, p_threshold double precision DEFAULT 0.45)
 RETURNS TABLE(podcast_id uuid, title text, slug text, similarity real, match_type text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  qn text := public.normalize_podcast_title(p_q);
  qn_nf text;
  is_short boolean;
BEGIN
  IF coalesce(qn,'') = '' THEN RETURN; END IF;
  qn_nf := btrim(regexp_replace(qn, '(^|\s)(podcast|podcasts|show|musor|epizod|epizodok|hivatalos|official)(\s|$)', ' ', 'g'));
  qn_nf := regexp_replace(qn_nf, '\s+', ' ', 'g');
  IF qn_nf = '' THEN qn_nf := qn; END IF;
  is_short := length(qn_nf) <= 6;

  RETURN QUERY
  WITH alias_hits AS (
    SELECT a.podcast_id, 0.98::real AS sim, 'alias'::text AS mtype
    FROM public.podcast_aliases a
    WHERE a.normalized_alias = qn_nf OR a.normalized_alias = qn
  ),
  base AS (
    SELECT p.id, p.title, p.slug, p.normalized_title, p.podiverzum_rank, p.rank_label
    FROM public.podcasts p
    WHERE p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND coalesce(p.rss_status,'') NOT IN ('failed','inactive','blocked','dead')
      AND p.normalized_title IS NOT NULL AND p.normalized_title <> ''
      AND (
        p.normalized_title = qn
        OR p.normalized_title = qn_nf
        OR (' ' || p.normalized_title || ' ') LIKE ('% ' || qn_nf || ' %')
        OR p.normalized_title LIKE (qn_nf || '%')
        OR p.normalized_title LIKE ('%' || qn_nf || '%')
        OR (length(qn_nf) >= 4 AND p.normalized_title % qn_nf)
        OR EXISTS (SELECT 1 FROM alias_hits ah WHERE ah.podcast_id = p.id)
      )
  ),
  scored AS (
    SELECT b.id, b.title, b.slug, b.podiverzum_rank, b.rank_label,
      GREATEST(
        COALESCE((SELECT sim FROM alias_hits ah WHERE ah.podcast_id = b.id LIMIT 1), 0::real),
        CASE
          WHEN b.normalized_title = qn_nf OR b.normalized_title = qn THEN 1.0::real
          WHEN is_short AND b.normalized_title LIKE (qn_nf || '%') THEN 0.95::real
          WHEN is_short AND (' ' || b.normalized_title || ' ') LIKE ('% ' || qn_nf || ' %') THEN 0.80::real
          WHEN (' ' || b.normalized_title || ' ') LIKE ('% ' || qn_nf || ' %') THEN 0.93::real
          WHEN b.normalized_title LIKE (qn_nf || '%') THEN 0.85::real
          WHEN b.normalized_title LIKE ('%' || qn_nf || '%') THEN 0.78::real
          ELSE similarity(b.normalized_title, qn_nf)::real
        END
      ) AS sim,
      CASE
        WHEN EXISTS (SELECT 1 FROM alias_hits ah WHERE ah.podcast_id = b.id) AND
             NOT (b.normalized_title = qn_nf OR b.normalized_title = qn) THEN 'alias'
        WHEN b.normalized_title = qn_nf OR b.normalized_title = qn THEN 'exact'
        WHEN is_short AND b.normalized_title LIKE (qn_nf || '%') THEN 'prefix'
        WHEN is_short AND (' ' || b.normalized_title || ' ') LIKE ('% ' || qn_nf || ' %') THEN 'token'
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
  ORDER BY
    s.sim DESC,
    CASE s.rank_label WHEN 'S' THEN 4 WHEN 'A' THEN 3 WHEN 'B' THEN 2 WHEN 'C' THEN 1 ELSE 0 END DESC,
    COALESCE(s.podiverzum_rank, 0) DESC
  LIMIT p_max;
END;
$function$;