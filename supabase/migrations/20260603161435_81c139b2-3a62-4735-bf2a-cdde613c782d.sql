
-- 1) taste_cards: revoke table-level SELECT, grant column-level SELECT on all columns EXCEPT hidden_embedding_prompt
REVOKE SELECT ON public.taste_cards FROM anon, authenticated;
GRANT SELECT (id, locale, type, title, subtitle, image_url, card_embedding, topic_tags, mood_tags, format_tags, psych_tags, archetype_tags, primary_axis, secondary_axis, stage, sensitivity_level, active, priority, catalog_fit_score, top_episode_similarity, validation_status, created_at, updated_at) ON public.taste_cards TO anon, authenticated;

-- 2) te_podiverzumod_shares: drop the permissive public-read policy that contradicts the "no direct client access" intent.
-- Public reads happen via the te_podiverzumod_shares_public view, accessed by the edge function with service_role.
DROP POLICY IF EXISTS "public can read non-expired shares via view" ON public.te_podiverzumod_shares;
