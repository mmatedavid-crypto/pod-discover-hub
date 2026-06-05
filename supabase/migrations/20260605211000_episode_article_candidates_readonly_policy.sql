-- The production verifier connects as readonly_codex. A GRANT is not enough on
-- an RLS-enabled table, so expose article-candidate rows to that verifier role
-- without changing public anon/authenticated visibility.

DO $$
BEGIN
  IF to_regclass('public.episode_article_candidates') IS NOT NULL THEN
    DROP POLICY IF EXISTS "episode article candidates readonly verifier read"
      ON public.episode_article_candidates;

    CREATE POLICY "episode article candidates readonly verifier read"
      ON public.episode_article_candidates
      FOR SELECT
      USING (current_user = 'readonly_codex');

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
      GRANT SELECT ON public.episode_article_candidates TO readonly_codex;
    END IF;
  END IF;
END $$;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_article_candidate_readonly_policy',
  jsonb_build_object(
    'version', 1,
    'policy', 'episode article candidates readonly verifier read',
    'role', 'readonly_codex',
    'reason', 'Production pipeline verifier must see persisted article candidates despite RLS.',
    'updated_at', now()
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
