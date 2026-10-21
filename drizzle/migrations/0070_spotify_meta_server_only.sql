-- Spotify episode metadata (incl. raw descriptions) is internal processing input only.
-- No visitor-facing code reads it; edge functions use the service role.
DROP POLICY IF EXISTS "Spotify meta is publicly readable" ON public.episode_spotify_meta;
REVOKE ALL ON public.episode_spotify_meta FROM anon, authenticated;
GRANT ALL ON public.episode_spotify_meta TO service_role;
COMMENT ON TABLE public.episode_spotify_meta IS 'Internal only: Spotify episode metadata for matching and internal clean-text/search processing. Never exposed to visitors (no anon/authenticated access).';