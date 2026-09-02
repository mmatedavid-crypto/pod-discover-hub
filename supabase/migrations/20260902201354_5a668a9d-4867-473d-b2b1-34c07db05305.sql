GRANT INSERT ON public.player_events TO anon;
GRANT INSERT, SELECT ON public.player_events TO authenticated;
GRANT ALL ON public.player_events TO service_role;