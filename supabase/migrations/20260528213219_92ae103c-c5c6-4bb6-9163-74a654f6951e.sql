ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS spotify_description text,
  ADD COLUMN IF NOT EXISTS spotify_html_description text,
  ADD COLUMN IF NOT EXISTS spotify_image_url_640 text,
  ADD COLUMN IF NOT EXISTS spotify_image_url_300 text,
  ADD COLUMN IF NOT EXISTS spotify_image_url_64 text,
  ADD COLUMN IF NOT EXISTS spotify_explicit boolean,
  ADD COLUMN IF NOT EXISTS spotify_media_type text,
  ADD COLUMN IF NOT EXISTS spotify_copyrights jsonb,
  ADD COLUMN IF NOT EXISTS spotify_available_markets text[],
  ADD COLUMN IF NOT EXISTS spotify_is_externally_hosted boolean,
  ADD COLUMN IF NOT EXISTS spotify_show_enriched_at timestamptz,
  ADD COLUMN IF NOT EXISTS spotify_episodes_last_synced_at timestamptz;

CREATE TABLE IF NOT EXISTS public.episode_spotify_meta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL UNIQUE,
  podcast_id uuid NOT NULL,
  spotify_episode_id text NOT NULL,
  spotify_url text,
  duration_ms integer,
  release_date date,
  release_date_precision text,
  spotify_description text,
  spotify_html_description text,
  spotify_image_url_640 text,
  spotify_image_url_300 text,
  spotify_image_url_64 text,
  spotify_explicit boolean,
  audio_preview_url text,
  spotify_language text,
  spotify_languages text[],
  is_playable boolean,
  restrictions jsonb,
  match_method text,
  match_confidence numeric,
  raw jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS episode_spotify_meta_spotify_id_idx
  ON public.episode_spotify_meta(spotify_episode_id);
CREATE INDEX IF NOT EXISTS episode_spotify_meta_podcast_idx
  ON public.episode_spotify_meta(podcast_id);
CREATE INDEX IF NOT EXISTS episode_spotify_meta_release_idx
  ON public.episode_spotify_meta(release_date DESC);

GRANT SELECT ON public.episode_spotify_meta TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.episode_spotify_meta TO authenticated;
GRANT ALL ON public.episode_spotify_meta TO service_role;

ALTER TABLE public.episode_spotify_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Spotify meta is publicly readable"
  ON public.episode_spotify_meta FOR SELECT
  USING (true);

CREATE POLICY "Service role manages spotify meta"
  ON public.episode_spotify_meta FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_episode_spotify_meta_set_updated_at
  BEFORE UPDATE ON public.episode_spotify_meta
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();