ALTER TABLE public.episode_youtube_links
  ADD COLUMN IF NOT EXISTS youtube_caption_available boolean,
  ADD COLUMN IF NOT EXISTS youtube_caption_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS episode_youtube_links_caption_candidates_idx
  ON public.episode_youtube_links (youtube_caption_available, match_score DESC, updated_at DESC)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS episode_youtube_links_caption_podcast_idx
  ON public.episode_youtube_links (podcast_id, youtube_caption_available, match_score DESC)
  WHERE status = 'confirmed';

CREATE OR REPLACE VIEW public.v_youtube_native_transcript_candidates AS
SELECT
  p.id AS podcast_id,
  p.title AS podcast_title,
  count(*) FILTER (WHERE eyl.status = 'confirmed' AND eyl.validation_reason @> '{"policy":"youtube_episode_match_v3"}'::jsonb) AS confirmed_youtube_episodes,
  count(*) FILTER (
    WHERE eyl.status = 'confirmed'
      AND eyl.validation_reason @> '{"policy":"youtube_episode_match_v3"}'::jsonb
      AND eyl.youtube_caption_available IS TRUE
  ) AS youtube_caption_available_episodes,
  count(*) FILTER (
    WHERE eyl.status = 'confirmed'
      AND eyl.validation_reason @> '{"policy":"youtube_episode_match_v3"}'::jsonb
      AND eyl.youtube_caption_available IS TRUE
      AND et.episode_id IS NULL
      AND yta.youtube_video_id IS NULL
  ) AS native_transcript_untried_episodes,
  count(*) FILTER (WHERE et.episode_id IS NOT NULL) AS stored_transcript_episodes,
  max(eyl.youtube_caption_checked_at) AS last_caption_check_at
FROM public.podcasts p
JOIN public.episode_youtube_links eyl ON eyl.podcast_id = p.id
LEFT JOIN public.episode_transcripts et
  ON et.episode_id = eyl.episode_id
  AND et.model IN ('supadata-youtube', 'supadata-youtube-asr')
LEFT JOIN public.youtube_transcript_attempts yta
  ON yta.youtube_video_id = eyl.youtube_video_id
  AND yta.match_policy = 'youtube_episode_match_v3'
  AND yta.status IN ('transcribed', 'no_captions', 'permanent_error')
WHERE p.is_hungarian IS TRUE
GROUP BY p.id, p.title;

CREATE OR REPLACE FUNCTION public.get_youtube_native_transcript_candidate_summary_v1(limit_count integer DEFAULT 50)
RETURNS TABLE (
  podcast_id uuid,
  podcast_title text,
  confirmed_youtube_episodes bigint,
  youtube_caption_available_episodes bigint,
  native_transcript_untried_episodes bigint,
  stored_transcript_episodes bigint,
  caption_coverage numeric,
  last_caption_check_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    podcast_id,
    podcast_title::text,
    confirmed_youtube_episodes,
    youtube_caption_available_episodes,
    native_transcript_untried_episodes,
    stored_transcript_episodes,
    CASE
      WHEN confirmed_youtube_episodes > 0
      THEN round(youtube_caption_available_episodes::numeric / confirmed_youtube_episodes::numeric, 4)
      ELSE 0
    END AS caption_coverage,
    last_caption_check_at
  FROM public.v_youtube_native_transcript_candidates
  WHERE native_transcript_untried_episodes > 0
  ORDER BY native_transcript_untried_episodes DESC, youtube_caption_available_episodes DESC, confirmed_youtube_episodes DESC
  LIMIT greatest(1, least(coalesce(limit_count, 50), 500));
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT EXECUTE ON FUNCTION public.get_youtube_native_transcript_candidate_summary_v1(integer) TO anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.get_youtube_native_transcript_candidate_summary_v1(integer) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    GRANT SELECT ON public.v_youtube_native_transcript_candidates TO readonly_codex;
    GRANT EXECUTE ON FUNCTION public.get_youtube_native_transcript_candidate_summary_v1(integer) TO readonly_codex;
  END IF;
END $$;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'youtube_transcript_controls',
  jsonb_build_object(
    'enabled', false,
    'batch', 10,
    'concurrency', 2,
    'delay_ms', 1800,
    'daily_budget_usd', 1.0,
    'preferred_lang', 'hu',
    'transcript_mode', 'native',
    'require_youtube_caption_available', true,
    'min_match_score', 0.84,
    'match_policy', 'youtube_episode_match_v3',
    'note', 'Native transcript credit gate: Supadata is called only for v3-confirmed videos where YouTube metadata reports caption availability.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'transcript_mode', 'native',
    'require_youtube_caption_available', true,
    'match_policy', 'youtube_episode_match_v3',
    'note', 'Native transcript credit gate: Supadata is called only for v3-confirmed videos where YouTube metadata reports caption availability.'
  ),
  updated_at = now();
