
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE IF NOT EXISTS public.episode_youtube_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL,
  podcast_id uuid NOT NULL,
  youtube_video_id text NOT NULL,
  youtube_channel_id text,
  youtube_title text,
  youtube_description text,
  youtube_published_at timestamptz,
  youtube_duration_seconds int,
  youtube_view_count bigint,
  match_score numeric,
  confidence text NOT NULL DEFAULT 'auto',
  status text NOT NULL DEFAULT 'candidate',
  found_by text,
  validated_by text,
  validation_reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, youtube_video_id)
);
CREATE INDEX IF NOT EXISTS idx_eyl_episode ON public.episode_youtube_links(episode_id);
CREATE INDEX IF NOT EXISTS idx_eyl_podcast ON public.episode_youtube_links(podcast_id);
CREATE INDEX IF NOT EXISTS idx_eyl_status  ON public.episode_youtube_links(status);
ALTER TABLE public.episode_youtube_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eyl public read" ON public.episode_youtube_links FOR SELECT USING (true);
CREATE POLICY "eyl admin write" ON public.episode_youtube_links FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER trg_eyl_updated_at BEFORE UPDATE ON public.episode_youtube_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.podcast_youtube_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  podcast_id uuid NOT NULL,
  youtube_channel_id text NOT NULL,
  channel_title text,
  channel_description text,
  channel_thumbnail_url text,
  subscriber_count bigint,
  video_count int,
  match_score numeric,
  confidence text NOT NULL DEFAULT 'auto',
  status text NOT NULL DEFAULT 'candidate',
  found_by text,
  validated_by text,
  validation_reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (podcast_id, youtube_channel_id)
);
CREATE INDEX IF NOT EXISTS idx_pyc_podcast ON public.podcast_youtube_candidates(podcast_id);
CREATE INDEX IF NOT EXISTS idx_pyc_status  ON public.podcast_youtube_candidates(status);
ALTER TABLE public.podcast_youtube_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pyc public read" ON public.podcast_youtube_candidates FOR SELECT USING (true);
CREATE POLICY "pyc admin write" ON public.podcast_youtube_candidates FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER trg_pyc_updated_at BEFORE UPDATE ON public.podcast_youtube_candidates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS youtube_channel_id        text,
  ADD COLUMN IF NOT EXISTS youtube_channel_title     text,
  ADD COLUMN IF NOT EXISTS youtube_pairing_status    text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS youtube_paired_at         timestamptz,
  ADD COLUMN IF NOT EXISTS youtube_last_scouted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS youtube_episode_count     int;
CREATE INDEX IF NOT EXISTS idx_podcasts_yt_pairing ON public.podcasts(youtube_pairing_status);

ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS youtube_video_id        text,
  ADD COLUMN IF NOT EXISTS youtube_pairing_status  text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS youtube_paired_at       timestamptz,
  ADD COLUMN IF NOT EXISTS youtube_match_score     numeric;
CREATE INDEX IF NOT EXISTS idx_episodes_yt_pairing ON public.episodes(youtube_pairing_status);

INSERT INTO public.app_settings(key, value) VALUES (
  'youtube_scout_controls',
  jsonb_build_object(
    'enabled', true,
    'tiers', jsonb_build_array('S','A'),
    'channel_batch', 20,
    'rescout_after_days', 30,
    'ai_validate_model', 'google/gemini-2.5-flash-lite',
    'ai_validate_threshold', 0.5,
    'min_channel_score_auto', 0.85,
    'daily_api_quota_units', 9000
  )
) ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings(key, value) VALUES (
  'youtube_episode_pairer_controls',
  jsonb_build_object(
    'enabled', true,
    'tiers', jsonb_build_array('S','A'),
    'podcast_batch', 10,
    'auto_pair_threshold', 0.85,
    'ai_validate_threshold', 0.6,
    'ai_validate_model', 'google/gemini-2.5-flash-lite',
    'max_videos_per_channel', 500,
    'rescan_after_days', 7
  )
) ON CONFLICT (key) DO NOTHING;
