-- Adds how many episodes of the same show share the identical description, so
-- show-level boilerplate (one channel blurb on every episode) is never treated
-- as episode content by the RSS repair.
DROP FUNCTION IF EXISTS public.clean_text_repair_targets_v2(text, integer, integer, uuid[]);
CREATE FUNCTION public.clean_text_repair_targets_v2(
  p_kind text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_episode_ids uuid[] DEFAULT NULL)
RETURNS TABLE(
  episode_id uuid, description text, summary text, clean_text_status text,
  best_source_type text, current_source_hash text, current_cleaned_text text,
  current_cleaner_method text, has_clean_row boolean, active_backups integer,
  same_description_in_show integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH t AS (
    SELECT e.id, e.podcast_id, e.description, e.summary, e.clean_text_status, e.published_at,
      b.source_type, c.source_hash, c.cleaned_text, c.cleaner_method, (c.episode_id IS NOT NULL) AS has_row
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id AND p.language_decision = 'accept_hungarian'
    LEFT JOIN public.episode_clean_text c ON c.episode_id = e.id
    LEFT JOIN public.episode_best_text_source b ON b.episode_id = e.id
    WHERE (p_episode_ids IS NULL OR e.id = ANY(p_episode_ids))
      AND CASE p_kind
        WHEN 'empty_substantive' THEN c.episode_id IS NOT NULL AND coalesce(btrim(c.cleaned_text), '') = '' AND length(coalesce(e.description, '')) > 500
        WHEN 'empty_any' THEN c.episode_id IS NOT NULL AND coalesce(btrim(c.cleaned_text), '') = '' AND length(coalesce(e.description, '')) >= 40
        WHEN 'overcut' THEN c.episode_id IS NOT NULL AND length(btrim(coalesce(c.cleaned_text, ''))) > 0
          AND length(coalesce(e.description, '')) >= 300 AND length(btrim(c.cleaned_text)) < 0.2 * length(e.description)
        WHEN 'missing_rss' THEN (c.episode_id IS NULL OR e.clean_text_status = 'skipped')
          AND length(coalesce(e.description, '')) >= 40 AND coalesce(e.clean_text_status, '') NOT IN ('pending', 'error')
        ELSE false END
    ORDER BY e.published_at DESC NULLS LAST, e.id
    OFFSET greatest(coalesce(p_offset, 0), 0)
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
  )
  SELECT t.id, t.description, t.summary, t.clean_text_status, t.source_type, t.source_hash,
    t.cleaned_text, t.cleaner_method, t.has_row,
    (SELECT count(*)::int FROM public.episode_clean_text_repair_backups k
      WHERE k.episode_id = t.id AND k.rolled_back_at IS NULL),
    (SELECT count(*)::int FROM public.episodes e2
      WHERE e2.podcast_id = t.podcast_id AND e2.description = t.description)
  FROM t
  ORDER BY t.published_at DESC NULLS LAST, t.id
$$;
REVOKE ALL ON FUNCTION public.clean_text_repair_targets_v2(text, integer, integer, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clean_text_repair_targets_v2(text, integer, integer, uuid[]) TO service_role;