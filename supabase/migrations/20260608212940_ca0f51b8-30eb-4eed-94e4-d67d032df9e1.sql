DROP POLICY IF EXISTS "taste_cards public read active" ON public.taste_cards;
REVOKE SELECT ON public.taste_cards FROM anon, authenticated;
REVOKE SELECT (hidden_embedding_prompt) ON public.taste_cards FROM anon, authenticated, PUBLIC;
DO $$ BEGIN
  IF has_column_privilege('anon', 'public.taste_cards', 'hidden_embedding_prompt', 'SELECT') THEN
    RAISE EXCEPTION 'anon still has SELECT on hidden_embedding_prompt';
  END IF;
  IF has_column_privilege('authenticated', 'public.taste_cards', 'hidden_embedding_prompt', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated still has SELECT on hidden_embedding_prompt';
  END IF;
END $$;