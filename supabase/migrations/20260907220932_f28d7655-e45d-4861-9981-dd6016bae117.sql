CREATE TABLE IF NOT EXISTS public.youtube_caption_cache (
  youtube_video_id text PRIMARY KEY,
  language text,
  is_generated boolean,
  status text NOT NULL DEFAULT 'ok',
  transcript text,
  transcript_chars integer NOT NULL DEFAULT 0,
  segments jsonb,
  duration_seconds integer,
  source text NOT NULL DEFAULT 'youtube-timedtext',
  via text,
  error_message text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS youtube_caption_cache_status_idx ON public.youtube_caption_cache (status);
CREATE INDEX IF NOT EXISTS youtube_caption_cache_fetched_idx ON public.youtube_caption_cache (fetched_at DESC);

GRANT ALL ON public.youtube_caption_cache TO service_role;

ALTER TABLE public.youtube_caption_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "yt caption cache admin read" ON public.youtube_caption_cache;
CREATE POLICY "yt caption cache admin read"
ON public.youtube_caption_cache
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.app_settings (key, value)
VALUES ('youtube_caption_direct_controls', jsonb_build_object(
  'enabled', false,
  'batch', 25,
  'delay_ms', 1200,
  'preferred_langs', jsonb_build_array('hu','en'),
  'min_match_score', 0.84,
  'use_proxy', 'auto',
  'max_ip_blocks_before_pause', 3,
  'paused_reason', null
))
ON CONFLICT (key) DO NOTHING;