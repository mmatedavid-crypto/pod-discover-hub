
-- Harden episode_chunks: remove public SELECT, allow only admin + service_role.
-- Public search continues to work via SECURITY DEFINER RPC search_episode_chunks.
DROP POLICY IF EXISTS "ep_chunks public read" ON public.episode_chunks;

CREATE POLICY "ep_chunks admin read"
  ON public.episode_chunks FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

REVOKE SELECT ON public.episode_chunks FROM anon, authenticated;
GRANT SELECT ON public.episode_chunks TO authenticated; -- needed so admin RLS can evaluate; rows still gated by policy
GRANT ALL ON public.episode_chunks TO service_role;

-- Defense-in-depth for taste_cards: explicit deny SELECT to anon/authenticated.
-- Public access continues via SECURITY DEFINER RPC get_active_taste_cards.
CREATE POLICY "taste_cards deny public read"
  ON public.taste_cards
  AS RESTRICTIVE
  FOR SELECT
  TO anon, authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
