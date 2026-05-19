-- ============================================================
-- 1. person_aliases schema expansion (PART 3)
-- ============================================================
ALTER TABLE public.person_aliases
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS scope_podcast_id uuid,
  ADD COLUMN IF NOT EXISTS scope_episode_id uuid,
  ADD COLUMN IF NOT EXISTS review_reason text;

-- Backfill: existing rows are implicitly global+accepted (already defaulted)
UPDATE public.person_aliases
   SET reviewed_at = COALESCE(reviewed_at, created_at)
 WHERE reviewed_at IS NULL;

-- Validation trigger (NOT a CHECK — keeps it mutable)
CREATE OR REPLACE FUNCTION public.person_aliases_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.scope NOT IN ('global','podcast','episode','needs_review') THEN
    RAISE EXCEPTION 'person_aliases.scope must be one of global|podcast|episode|needs_review (got %)', NEW.scope;
  END IF;
  IF NEW.status NOT IN ('accepted','rejected','needs_review','pending') THEN
    RAISE EXCEPTION 'person_aliases.status must be one of accepted|rejected|needs_review|pending (got %)', NEW.status;
  END IF;
  IF NEW.scope = 'podcast' AND NEW.scope_podcast_id IS NULL THEN
    RAISE EXCEPTION 'person_aliases.scope=podcast requires scope_podcast_id';
  END IF;
  IF NEW.scope = 'episode' AND NEW.scope_episode_id IS NULL THEN
    RAISE EXCEPTION 'person_aliases.scope=episode requires scope_episode_id';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_person_aliases_validate ON public.person_aliases;
CREATE TRIGGER trg_person_aliases_validate
BEFORE INSERT OR UPDATE ON public.person_aliases
FOR EACH ROW EXECUTE FUNCTION public.person_aliases_validate();

CREATE INDEX IF NOT EXISTS idx_person_aliases_status ON public.person_aliases (status);
CREATE INDEX IF NOT EXISTS idx_person_aliases_scope ON public.person_aliases (scope);
CREATE INDEX IF NOT EXISTS idx_person_aliases_norm_status ON public.person_aliases (normalized_alias) WHERE status = 'accepted';

-- ============================================================
-- 2. Common Hungarian surname watchlist
-- ============================================================
CREATE TABLE IF NOT EXISTS public.person_common_surname_watchlist (
  surname text PRIMARY KEY,
  normalized text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.person_common_surname_watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "surname_watchlist public read" ON public.person_common_surname_watchlist;
CREATE POLICY "surname_watchlist public read"
  ON public.person_common_surname_watchlist FOR SELECT USING (true);

DROP POLICY IF EXISTS "surname_watchlist admin write" ON public.person_common_surname_watchlist;
CREATE POLICY "surname_watchlist admin write"
  ON public.person_common_surname_watchlist FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Seed: leggyakoribb magyar vezetéknevek + adjective-like surnames
INSERT INTO public.person_common_surname_watchlist (surname, normalized, reason) VALUES
  ('Nagy','nagy','common surname + adjective'),
  ('Szabó','szabo','common surname'),
  ('Kovács','kovacs','common surname'),
  ('Tóth','toth','common surname'),
  ('Kiss','kiss','common surname'),
  ('Varga','varga','common surname'),
  ('Horváth','horvath','common surname'),
  ('Balogh','balogh','common surname'),
  ('Papp','papp','common surname'),
  ('Lakatos','lakatos','common surname'),
  ('Takács','takacs','common surname'),
  ('Juhász','juhasz','common surname'),
  ('Németh','nemeth','common surname'),
  ('Farkas','farkas','common surname + animal noun'),
  ('Molnár','molnar','common surname'),
  ('Magyar','magyar','common surname AND adjective (nationality)'),
  ('Orosz','orosz','common surname AND adjective (russian)'),
  ('Német','nemet','common surname AND adjective (german)'),
  ('Tót','tot','common surname AND adjective'),
  ('Fekete','fekete','common surname AND adjective (black)'),
  ('Fehér','feher','common surname AND adjective (white)'),
  ('Vörös','voros','common surname AND adjective (red)'),
  ('Király','kiraly','common surname AND noun (king)'),
  ('Pásztor','pasztor','common surname AND noun (shepherd)'),
  ('Polgár','polgar','common surname AND noun (citizen)')
ON CONFLICT (surname) DO NOTHING;

-- ============================================================
-- 3. App settings: judge budget bump
-- ============================================================
INSERT INTO public.app_settings (key, value) VALUES (
  'person_relevance_judge_controls',
  jsonb_build_object(
    'daily_budget_usd', 10.0,
    'batch_limit', 50,
    'enabled', true,
    'note', 'Phase 1 burst to drain pending mention backlog'
  )
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- ============================================================
-- 4. Diagnostics views (PART 9)
-- ============================================================

-- 4.1 Surname-only candidates: single-token name OR name appears on watchlist as sole token
CREATE OR REPLACE VIEW public.v_person_diag_surname_only_candidates AS
SELECT
  p.id, p.name, p.slug, p.is_public, p.is_indexable, p.is_browsable_in_people_hub,
  p.gated_episode_count, p.gated_podcast_count, p.confidence, p.identity_status,
  array_length(string_to_array(trim(p.name),' '),1) AS token_count,
  EXISTS (SELECT 1 FROM public.person_common_surname_watchlist w
          WHERE w.normalized = lower(trim(p.normalized_name))) AS on_watchlist,
  CASE
    WHEN array_length(string_to_array(trim(p.name),' '),1) = 1
     AND EXISTS (SELECT 1 FROM public.person_common_surname_watchlist w
                 WHERE w.normalized = lower(trim(p.normalized_name)))
    THEN 'high_risk'
    WHEN array_length(string_to_array(trim(p.name),' '),1) = 1
    THEN 'medium_risk'
    ELSE 'low_risk'
  END AS risk_level
FROM public.people p
WHERE array_length(string_to_array(trim(p.name),' '),1) = 1
   OR EXISTS (SELECT 1 FROM public.person_common_surname_watchlist w
              WHERE w.normalized = lower(trim(p.normalized_name)));

-- 4.2 Duplicate clusters: normalized_name similarity among public/indexable
CREATE OR REPLACE VIEW public.v_person_diag_duplicate_clusters AS
SELECT
  a.id   AS person_a_id, a.name   AS person_a_name, a.slug AS person_a_slug,
  a.gated_episode_count AS a_eps, a.is_public AS a_public, a.is_indexable AS a_indexable,
  b.id   AS person_b_id, b.name   AS person_b_name, b.slug AS person_b_slug,
  b.gated_episode_count AS b_eps, b.is_public AS b_public, b.is_indexable AS b_indexable,
  similarity(a.normalized_name, b.normalized_name) AS sim
FROM public.people a
JOIN public.people b
  ON a.id < b.id
 AND a.normalized_name % b.normalized_name
 AND similarity(a.normalized_name, b.normalized_name) >= 0.6
WHERE (a.is_public OR a.is_indexable OR a.is_browsable_in_people_hub
   OR b.is_public OR b.is_indexable OR b.is_browsable_in_people_hub)
  AND a.identity_status <> 'merged_into'
  AND b.identity_status <> 'merged_into';

-- 4.3 High reject-ratio public pages
CREATE OR REPLACE VIEW public.v_person_diag_high_reject_ratio AS
WITH stats AS (
  SELECT
    p.id, p.name, p.slug, p.is_public, p.is_indexable, p.gated_episode_count,
    count(*) FILTER (WHERE pem.relevance_status = 'accepted')      AS accepted_cnt,
    count(*) FILTER (WHERE pem.relevance_status = 'rejected')      AS rejected_cnt,
    count(*) FILTER (WHERE pem.relevance_status = 'needs_review')  AS needs_review_cnt,
    count(*) FILTER (WHERE pem.relevance_status = 'pending')       AS pending_cnt,
    count(*)                                                       AS total_cnt
  FROM public.people p
  LEFT JOIN public.person_episode_mentions pem ON pem.person_id = p.id
  WHERE p.is_public OR p.is_indexable
  GROUP BY p.id, p.name, p.slug, p.is_public, p.is_indexable, p.gated_episode_count
)
SELECT *,
  CASE WHEN (accepted_cnt + rejected_cnt) > 0
       THEN rejected_cnt::numeric / (accepted_cnt + rejected_cnt)
       ELSE NULL END AS reject_ratio
FROM stats
WHERE (accepted_cnt + rejected_cnt) >= 3
  AND rejected_cnt::numeric / NULLIF(accepted_cnt + rejected_cnt, 0) >= 0.4
ORDER BY rejected_cnt DESC;

-- 4.4 Alias review queue
CREATE OR REPLACE VIEW public.v_person_diag_alias_review_queue AS
SELECT
  pa.id, pa.person_id, p.name AS person_name, p.slug AS person_slug,
  pa.alias, pa.normalized_alias, pa.scope, pa.status, pa.confidence,
  pa.source, pa.review_reason, pa.created_at, pa.reviewed_at,
  EXISTS (SELECT 1 FROM public.person_common_surname_watchlist w
          WHERE w.normalized = pa.normalized_alias) AS on_surname_watchlist,
  array_length(string_to_array(trim(pa.alias),' '),1) AS token_count
FROM public.person_aliases pa
JOIN public.people p ON p.id = pa.person_id
WHERE pa.status IN ('needs_review','pending')
   OR (pa.scope = 'global' AND pa.status = 'accepted'
       AND array_length(string_to_array(trim(pa.alias),' '),1) = 1
       AND EXISTS (SELECT 1 FROM public.person_common_surname_watchlist w
                   WHERE w.normalized = pa.normalized_alias));

-- 4.5 Weak public pages: public but thin evidence
CREATE OR REPLACE VIEW public.v_person_diag_weak_public_pages AS
WITH ev AS (
  SELECT
    p.id, p.name, p.slug, p.is_public, p.is_indexable, p.is_browsable_in_people_hub,
    p.gated_episode_count, p.gated_podcast_count, p.confidence,
    count(*) FILTER (WHERE pem.relevance_status = 'accepted') AS accepted_cnt,
    count(*) FILTER (WHERE pem.relevance_status = 'pending')  AS pending_cnt
  FROM public.people p
  LEFT JOIN public.person_episode_mentions pem ON pem.person_id = p.id
  WHERE p.is_public OR p.is_indexable
  GROUP BY p.id
)
SELECT *
FROM ev
WHERE accepted_cnt < 2
   OR gated_episode_count <= 1
   OR (gated_podcast_count <= 1 AND accepted_cnt < 3);

-- 4.6 Pending mention backlog per person
CREATE OR REPLACE VIEW public.v_person_diag_pending_backlog AS
SELECT
  p.id, p.name, p.slug, p.is_public, p.is_indexable,
  count(*) FILTER (WHERE pem.relevance_status = 'pending')      AS pending_cnt,
  count(*) FILTER (WHERE pem.relevance_status = 'needs_review') AS needs_review_cnt,
  count(*) AS total_mentions
FROM public.people p
JOIN public.person_episode_mentions pem ON pem.person_id = p.id
GROUP BY p.id, p.name, p.slug, p.is_public, p.is_indexable
HAVING count(*) FILTER (WHERE pem.relevance_status IN ('pending','needs_review')) >= 3
ORDER BY pending_cnt DESC;

-- Lock down diagnostics views to admins only (they expose review state)
REVOKE ALL ON public.v_person_diag_surname_only_candidates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_person_diag_duplicate_clusters       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_person_diag_high_reject_ratio        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_person_diag_alias_review_queue       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_person_diag_weak_public_pages        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_person_diag_pending_backlog          FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_person_diag_surname_only_candidates TO service_role;
GRANT  SELECT ON public.v_person_diag_duplicate_clusters       TO service_role;
GRANT  SELECT ON public.v_person_diag_high_reject_ratio        TO service_role;
GRANT  SELECT ON public.v_person_diag_alias_review_queue       TO service_role;
GRANT  SELECT ON public.v_person_diag_weak_public_pages        TO service_role;
GRANT  SELECT ON public.v_person_diag_pending_backlog          TO service_role;