-- Public reader for cleaned episode descriptions with source attribution.
-- Sources are allowlisted in app_settings.public_clean_text_display.allowed_sources;
-- transcript-derived and AI-trimmed text is never returned. No table grants.
CREATE OR REPLACE FUNCTION public.get_episode_public_clean_description_v2(p_episode_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH allowed AS (
    SELECT coalesce((SELECT value->'allowed_sources' FROM public.app_settings WHERE key = 'public_clean_text_display'), '[]'::jsonb) AS srcs
  ),
  c AS (
    SELECT ct.cleaned_text, e.youtube_url, e.youtube_video_id, e.spotify_url, e.id AS episode_id,
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
      AND ct.quality_status IN ('valid', 'valid_short')
      AND ct.cleaner_method LIKE 'deterministic_v4%'
      AND ct.cleaner_method NOT LIKE '%ai_trim%'
      AND length(coalesce(ct.cleaned_text, '')) >= 40
  )
  SELECT jsonb_build_object(
    'text', c.cleaned_text,
    'source', c.src,
    'source_url', CASE
      WHEN c.src = 'youtube' THEN coalesce(nullif(c.youtube_url, ''),
        CASE WHEN c.youtube_video_id IS NOT NULL THEN 'https://www.youtube.com/watch?v=' || c.youtube_video_id END)
      WHEN c.src = 'spotify' THEN coalesce(nullif(c.spotify_url, ''),
        (SELECT 'https://open.spotify.com/episode/' || m.spotify_episode_id FROM public.episode_spotify_meta m
          WHERE m.episode_id = c.episode_id AND m.spotify_episode_id IS NOT NULL LIMIT 1))
      ELSE NULL END)
  FROM c, allowed
  WHERE c.src <> 'transcript' AND allowed.srcs ? c.src
$function$;

REVOKE ALL ON FUNCTION public.get_episode_public_clean_description_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_episode_public_clean_description_v2(uuid) TO anon, authenticated, service_role;