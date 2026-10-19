DROP POLICY IF EXISTS "pilot groups are public" ON public.episode_answer_pilot;
CREATE POLICY "pilot groups admin read" ON public.episode_answer_pilot FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "ep_emb public read" ON public.episode_embeddings;
CREATE POLICY "ep_emb admin read" ON public.episode_embeddings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));