
CREATE TABLE IF NOT EXISTS public.player_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,
  episode_id UUID NULL,
  podcast_id UUID NULL,
  session_id TEXT NULL,
  position_sec INTEGER NULL,
  duration_sec INTEGER NULL,
  playback_rate NUMERIC NULL,
  viewport_width INTEGER NULL,
  user_agent TEXT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_events_created_at_idx ON public.player_events (created_at DESC);
CREATE INDEX IF NOT EXISTS player_events_episode_idx ON public.player_events (episode_id);
CREATE INDEX IF NOT EXISTS player_events_type_idx ON public.player_events (event_type);

ALTER TABLE public.player_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can insert player events" ON public.player_events;
CREATE POLICY "Anyone can insert player events"
  ON public.player_events FOR INSERT
  TO public
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can read player events" ON public.player_events;
CREATE POLICY "Admins can read player events"
  ON public.player_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.app_settings (key, value)
VALUES (
  'smart_player',
  jsonb_build_object(
    'enabled', true,
    'show_on_public_episode_pages', true,
    'dev_preview_enabled', true,
    'show_taste_buttons', false,
    'show_semantic_queue', false
  )
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
