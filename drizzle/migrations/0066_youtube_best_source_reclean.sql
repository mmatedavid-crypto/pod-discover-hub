-- Verified-YouTube best-source backfill targets, quality metrics, and a gated
-- public clean-description reader (off unless an owner allowlists sources).

CREATE OR REPLACE FUNCTION public.best_source_youtube_gain_targets_v1(p_after uuid DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE(episode_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT l.episode_id
  FROM public.episode_youtube_links l
  JOIN public.episodes e ON e.id = l.episode_id
  JOIN public.podcasts p ON p.id = e.podcast_id
  WHERE l.status = 'confirmed'
    AND l.validation_reason->>'policy' = 'youtube_episode_match_v3'
    AND l.match_score >= 0.78
    AND p.language_decision = 'accept_hungarian'
    AND length(coalesce(l.youtube_description, '')) >= length(coalesce(e.description, '')) + 300
    AND (p_after IS NULL OR l.episode_id > p_after)
  ORDER BY l.episode_id
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
$$;
REVOKE ALL ON FUNCTION public.best_source_youtube_gain_targets_v1(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.best_source_youtube_gain_targets_v1(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.youtube_source_quality_metrics_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT DISTINCT l.episode_id
    FROM public.episode_youtube_links l
    JOIN public.episodes e ON e.id = l.episode_id
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE l.status = 'confirmed'
      AND l.validation_reason->>'policy' = 'youtube_episode_match_v3'
      AND l.match_score >= 0.78
      AND p.language_decision = 'accept_hungarian'
      AND length(coalesce(l.youtube_description, '')) >= length(coalesce(e.description, '')) + 300
  )
  SELECT jsonb_build_object(
    'targets', count(*),
    'best_none', count(*) FILTER (WHERE b.episode_id IS NULL),
    'best_rss', count(*) FILTER (WHERE b.source_type = 'rss'),
    'best_youtube', count(*) FILTER (WHERE b.source_type = 'youtube'),
    'best_other', count(*) FILTER (WHERE b.source_type NOT IN ('rss', 'youtube')),
    'gain_youtube_better', count(*) FILTER (WHERE b.evidence->'youtube_gain'->>'decision' = 'youtube_better'),
    'gain_evaluated', count(*) FILTER (WHERE b.evidence ? 'youtube_gain'),
    'clean_youtube_based', count(*) FILTER (WHERE c.cleaner_method LIKE '%youtube%' OR c.cleaner_method LIKE '%ytdesc%'),
    'clean_youtube_v1', count(*) FILTER (WHERE c.cleaner_method LIKE 'deterministic_v4+youtube%'),
    'reclean_pending', count(*) FILTER (WHERE b.reclean_status = 'pending'),
    'reclean_applied', count(*) FILTER (WHERE b.reclean_status = 'applied'),
    'reclean_rejected', count(*) FILTER (WHERE b.reclean_status = 'rejected_quality'),
    'reclean_conflict', count(*) FILTER (WHERE b.reclean_status = 'conflict'),
    'avg_clean_len', round(avg(length(c.cleaned_text)))
  )
  FROM t
  LEFT JOIN public.episode_best_text_source b ON b.episode_id = t.episode_id
  LEFT JOIN public.episode_clean_text c ON c.episode_id = t.episode_id
$$;
REVOKE ALL ON FUNCTION public.youtube_source_quality_metrics_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.youtube_source_quality_metrics_v1() TO service_role;

-- Public reader: returns cleaned text only for sources an owner allowlisted in
-- app_settings.public_clean_text_display.allowed_sources (default: none).
-- Transcript-derived and AI-trimmed text is never returned. No table grants.
CREATE OR REPLACE FUNCTION public.get_episode_public_clean_description_v1(p_episode_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH allowed AS (
    SELECT coalesce((SELECT value->'allowed_sources' FROM public.app_settings WHERE key = 'public_clean_text_display'), '[]'::jsonb) AS srcs
  ),
  c AS (
    SELECT ct.cleaned_text, ct.cleaner_method,
      CASE
        WHEN ct.cleaner_method LIKE '%transcript%' OR coalesce(ct.source_type, '') = 'transcript' THEN 'transcript'
        WHEN ct.cleaner_method LIKE '%youtube%' OR ct.cleaner_method LIKE '%ytdesc%' THEN 'youtube'
        WHEN ct.cleaner_method LIKE '%article%' THEN 'article'
        WHEN ct.cleaner_method LIKE '%spotify%' THEN 'spotify'
        ELSE coalesce(nullif(ct.source_type, ''), 'rss')
      END AS src
    FROM public.episode_clean_text ct
    JOIN public.episodes e ON e.id = ct.episode_id
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE ct.episode_id = p_episode_id
      AND p.language_decision = 'accept_hungarian'
      AND e.clean_text_status = 'done'
      AND ct.quality_status = 'valid'
      AND ct.cleaner_method LIKE 'deterministic_v4%'
      AND ct.cleaner_method NOT LIKE '%ai_trim%'
  )
  SELECT c.cleaned_text FROM c, allowed
  WHERE c.src <> 'transcript' AND allowed.srcs ? c.src
$$;
REVOKE ALL ON FUNCTION public.get_episode_public_clean_description_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_episode_public_clean_description_v1(uuid) TO anon, authenticated, service_role;