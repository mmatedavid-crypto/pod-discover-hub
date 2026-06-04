
ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

CREATE INDEX IF NOT EXISTS idx_episodes_duration_seconds
  ON public.episodes (duration_seconds)
  WHERE duration_seconds IS NOT NULL;

UPDATE public.episodes e
SET duration_seconds = ROUND(sm.duration_ms / 1000.0)::int
FROM public.episode_spotify_meta sm
WHERE sm.episode_id = e.id
  AND sm.duration_ms IS NOT NULL
  AND sm.duration_ms > 0
  AND e.duration_seconds IS NULL;

UPDATE public.episodes e
SET duration_seconds = yl.youtube_duration_seconds
FROM public.episode_youtube_links yl
WHERE yl.episode_id = e.id
  AND yl.youtube_duration_seconds IS NOT NULL
  AND yl.youtube_duration_seconds > 0
  AND e.duration_seconds IS NULL;

UPDATE public.episodes e
SET duration_seconds = ROUND(t.duration_seconds)::int
FROM public.episode_transcripts t
WHERE t.episode_id = e.id
  AND t.duration_seconds IS NOT NULL
  AND t.duration_seconds > 0
  AND e.duration_seconds IS NULL;
