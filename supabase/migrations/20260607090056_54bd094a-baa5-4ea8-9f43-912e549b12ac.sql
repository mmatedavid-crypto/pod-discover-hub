-- Regression guard: ensure hidden_embedding_prompt is never readable by anon/authenticated.
-- This column contains the prompt template used to generate taste card embeddings and
-- must remain server-only. Re-apply the column-level REVOKE idempotently so future
-- schema migrations / restores cannot silently re-grant SELECT.
REVOKE SELECT (hidden_embedding_prompt) ON public.taste_cards FROM anon;
REVOKE SELECT (hidden_embedding_prompt) ON public.taste_cards FROM authenticated;
REVOKE SELECT (hidden_embedding_prompt) ON public.taste_cards FROM PUBLIC;

DO $$
BEGIN
  IF has_column_privilege('anon', 'public.taste_cards', 'hidden_embedding_prompt', 'SELECT') THEN
    RAISE EXCEPTION 'anon must not have SELECT on taste_cards.hidden_embedding_prompt';
  END IF;
  IF has_column_privilege('authenticated', 'public.taste_cards', 'hidden_embedding_prompt', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated must not have SELECT on taste_cards.hidden_embedding_prompt';
  END IF;
END $$;

COMMENT ON COLUMN public.taste_cards.hidden_embedding_prompt IS
  'Server-only prompt used for embedding generation. SELECT must remain revoked from anon/authenticated — see regression guard in this migration.';