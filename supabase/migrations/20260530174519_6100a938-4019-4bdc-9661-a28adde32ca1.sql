CREATE TABLE IF NOT EXISTS public.youtube_transcript_attempts (
  youtube_video_id text NOT NULL,
  match_policy text NOT NULL DEFAULT 'youtube_episode_match_v3',
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('started', 'transcribed', 'no_captions', 'error', 'permanent_error')),
  match_score numeric,
  transcript_chars integer,
  cost_usd numeric NOT NULL DEFAULT 0,
  error_message text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (youtube_video_id, match_policy)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.youtube_transcript_attempts TO authenticated;
GRANT ALL ON public.youtube_transcript_attempts TO service_role;

CREATE INDEX IF NOT EXISTS youtube_transcript_attempts_episode_idx
  ON public.youtube_transcript_attempts (episode_id);

CREATE INDEX IF NOT EXISTS youtube_transcript_attempts_status_idx
  ON public.youtube_transcript_attempts (status, updated_at DESC);

ALTER TABLE public.youtube_transcript_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "youtube transcript attempts admin read" ON public.youtube_transcript_attempts;
CREATE POLICY "youtube transcript attempts admin read"
  ON public.youtube_transcript_attempts
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "youtube transcript attempts service write" ON public.youtube_transcript_attempts;
CREATE POLICY "youtube transcript attempts service write"
  ON public.youtube_transcript_attempts
  FOR ALL
  USING (auth.role() = 'service_role' OR has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.role() = 'service_role' OR has_role(auth.uid(), 'admin'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    GRANT SELECT ON public.youtube_transcript_attempts TO readonly_codex;
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
    'min_match_score', 0.84,
    'min_description_gain_chars', 300,
    'min_youtube_description_chars', 250,
    'short_rss_chars', 160,
    'match_policy', 'youtube_episode_match_v3',
    'note', 'Supadata credit guard: only v3-confirmed YouTube matches, deduped per video, with description gain gate.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'batch', 10,
    'concurrency', 2,
    'delay_ms', 1800,
    'daily_budget_usd', 1.0,
    'transcript_mode', 'native',
    'min_match_score', 0.84,
    'min_description_gain_chars', 300,
    'min_youtube_description_chars', 250,
    'short_rss_chars', 160,
    'match_policy', 'youtube_episode_match_v3',
    'note', 'Supadata credit guard: only v3-confirmed YouTube matches, deduped per video, with description gain gate.'
  ),
  updated_at = now();