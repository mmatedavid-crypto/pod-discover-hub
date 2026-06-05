CREATE OR REPLACE FUNCTION public.pending_youtube_transcript_candidates(
  p_limit int DEFAULT 200,
  p_min_match_score numeric DEFAULT 0.84,
  p_require_caption boolean DEFAULT false
)
RETURNS TABLE (
  episode_id uuid,
  podcast_id uuid,
  youtube_video_id text,
  youtube_description text,
  youtube_duration_seconds int,
  youtube_caption_available boolean,
  match_score numeric,
  validation_reason jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (eyl.youtube_video_id)
    eyl.episode_id,
    eyl.podcast_id,
    eyl.youtube_video_id,
    eyl.youtube_description,
    eyl.youtube_duration_seconds,
    eyl.youtube_caption_available,
    eyl.match_score,
    eyl.validation_reason
  FROM public.episode_youtube_links eyl
  WHERE eyl.status = 'confirmed'
    AND eyl.validation_reason @> '{"policy":"youtube_episode_match_v3"}'::jsonb
    AND eyl.match_score >= p_min_match_score
    AND (NOT p_require_caption OR eyl.youtube_caption_available = true)
    AND NOT EXISTS (
      SELECT 1 FROM public.youtube_transcript_attempts a
      WHERE a.youtube_video_id = eyl.youtube_video_id
        AND a.status IN ('transcribed','no_captions','permanent_error','started')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.episode_transcripts t
      WHERE t.episode_id = eyl.episode_id AND t.model = 'supadata-youtube'
    )
  ORDER BY eyl.youtube_video_id, eyl.match_score DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.pending_youtube_transcript_candidates(int, numeric, boolean) TO service_role;