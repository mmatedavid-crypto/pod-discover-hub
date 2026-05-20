
-- 1. Schema additions on people
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS identity_ambiguous BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_candidate BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_human_review_identity BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS collision_risk_score NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collision_signals JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_people_collision_risk ON public.people(collision_risk_score DESC) WHERE collision_risk_score > 0;
CREATE INDEX IF NOT EXISTS idx_people_identity_ambiguous ON public.people(identity_ambiguous) WHERE identity_ambiguous;
CREATE INDEX IF NOT EXISTS idx_people_duplicate_candidate ON public.people(duplicate_candidate) WHERE duplicate_candidate;

-- 2. Detection function. Pure SQL, no AI calls.
CREATE OR REPLACE FUNCTION public.recompute_person_collision_flags()
RETURNS TABLE(
  total_scanned int,
  flagged_ambiguous int,
  flagged_duplicate int,
  flagged_review int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int := 0;
  v_amb int := 0;
  v_dup int := 0;
  v_rev int := 0;
BEGIN
  -- Pre-compute per-person signals into a temp table
  CREATE TEMP TABLE _coll AS
  WITH
  -- First token = surname (HU convention).
  first_tok AS (
    SELECT id, split_part(normalized_name, ' ', 1) AS surname_norm
    FROM people
  ),
  surname_match AS (
    SELECT ft.id, w.surname AS matched_surname
    FROM first_tok ft
    JOIN person_common_surname_watchlist w ON w.normalized = ft.surname_norm
  ),
  dup_rows AS (
    SELECT normalized_name, count(*) AS row_count, array_agg(id) AS ids
    FROM people
    GROUP BY normalized_name
    HAVING count(*) > 1
  ),
  scored AS (
    SELECT
      p.id,
      p.normalized_name,
      p.gated_podcast_count AS pods,
      (p.host_count + p.guest_count + p.subject_count) AS strong_roles,
      sm.matched_surname,
      dr.row_count AS dup_row_count,
      COALESCE(p.disambiguation_label, '') <> '' AS already_disambiguated,
      CASE
        WHEN p.gated_podcast_count > 0
        THEN (p.host_count + p.guest_count + p.subject_count)::numeric / p.gated_podcast_count
        ELSE 0
      END AS strong_ratio
    FROM people p
    LEFT JOIN surname_match sm ON sm.id = p.id
    LEFT JOIN dup_rows dr ON dr.normalized_name = p.normalized_name
  )
  SELECT
    s.id,
    s.normalized_name,
    s.pods,
    s.strong_roles,
    s.strong_ratio,
    s.matched_surname,
    s.dup_row_count,
    s.already_disambiguated,
    GREATEST(0,
      (CASE WHEN s.matched_surname IS NOT NULL THEN 30 ELSE 0 END)
      + (CASE
           WHEN s.pods >= 10 THEN 30
           WHEN s.pods >= 5 THEN 15
           WHEN s.pods >= 3 THEN 5
           ELSE 0
         END)
      + (CASE
           WHEN s.pods >= 3 AND s.strong_ratio < 0.2 THEN 25
           WHEN s.pods >= 3 AND s.strong_ratio < 0.4 THEN 10
           ELSE 0
         END)
      + (CASE WHEN s.dup_row_count IS NOT NULL THEN 20 ELSE 0 END)
      - (CASE WHEN s.already_disambiguated THEN 50 ELSE 0 END)
    ) AS risk
  FROM scored s;

  SELECT count(*) INTO v_total FROM _coll;

  UPDATE people p
  SET
    collision_risk_score = c.risk,
    collision_signals = jsonb_build_object(
      'pods', c.pods,
      'strong_roles', c.strong_roles,
      'strong_ratio', round(c.strong_ratio::numeric, 3),
      'surname_watchlist', c.matched_surname,
      'duplicate_row_count', c.dup_row_count,
      'already_disambiguated', c.already_disambiguated,
      'computed_at', now()
    ),
    identity_ambiguous = (c.risk >= 50 AND NOT c.already_disambiguated),
    duplicate_candidate = (c.dup_row_count IS NOT NULL AND NOT c.already_disambiguated),
    needs_human_review_identity = (c.risk >= 30 AND NOT c.already_disambiguated)
  FROM _coll c
  WHERE p.id = c.id;

  SELECT
    count(*) FILTER (WHERE risk >= 50 AND NOT already_disambiguated),
    count(*) FILTER (WHERE dup_row_count IS NOT NULL AND NOT already_disambiguated),
    count(*) FILTER (WHERE risk >= 30 AND NOT already_disambiguated)
  INTO v_amb, v_dup, v_rev
  FROM _coll;

  DROP TABLE _coll;

  RETURN QUERY SELECT v_total, v_amb, v_dup, v_rev;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_person_collision_flags() FROM public;
GRANT EXECUTE ON FUNCTION public.recompute_person_collision_flags() TO authenticated, service_role;

-- 3. Collision buckets view
CREATE OR REPLACE VIEW public.v_person_collision_buckets AS
SELECT
  p.normalized_name,
  count(*) AS row_count,
  sum(p.gated_podcast_count) AS total_pods,
  sum(p.gated_episode_count) AS total_eps,
  max(p.collision_risk_score) AS max_risk,
  avg(p.collision_risk_score)::numeric(10,2) AS avg_risk,
  bool_or(p.identity_ambiguous) AS any_ambiguous,
  bool_or(p.duplicate_candidate) AS any_duplicate,
  array_agg(p.id ORDER BY p.gated_podcast_count DESC) AS person_ids,
  array_agg(DISTINCT COALESCE(p.disambiguation_label, '')) FILTER (WHERE p.disambiguation_label IS NOT NULL) AS existing_labels
FROM people p
WHERE p.collision_risk_score >= 30 OR (
  SELECT count(*) FROM people p2 WHERE p2.normalized_name = p.normalized_name
) > 1
GROUP BY p.normalized_name
ORDER BY max(p.collision_risk_score) DESC, sum(p.gated_podcast_count) DESC;

GRANT SELECT ON public.v_person_collision_buckets TO anon, authenticated;

-- 4. Scoped alias helper (no global merge; podcast-scoped only)
CREATE OR REPLACE FUNCTION public.upsert_scoped_person_alias(
  p_alias_person_id uuid,
  p_canonical_person_id uuid,
  p_podcast_id uuid,
  p_reason text DEFAULT 'scoped_disambig'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alias_name text;
  v_norm text;
  v_moved_mentions int := 0;
  v_moved_map int := 0;
BEGIN
  IF p_alias_person_id = p_canonical_person_id THEN
    RAISE EXCEPTION 'alias and canonical must differ';
  END IF;

  SELECT name, normalized_name INTO v_alias_name, v_norm
  FROM people WHERE id = p_alias_person_id;

  IF v_alias_name IS NULL THEN
    RAISE EXCEPTION 'alias person % not found', p_alias_person_id;
  END IF;

  -- Record the scoped alias on the canonical person
  INSERT INTO person_aliases (person_id, alias, normalized_alias, scope, scope_podcast_id, status, confidence, source, review_reason)
  VALUES (p_canonical_person_id, v_alias_name, v_norm, 'podcast', p_podcast_id, 'accepted', 0.9, 'manual_scoped_merge', p_reason)
  ON CONFLICT DO NOTHING;

  -- Move episode mentions (only the ones inside scope podcast) onto the canonical id
  WITH moved AS (
    UPDATE person_episode_mentions
       SET person_id = p_canonical_person_id
     WHERE person_id = p_alias_person_id AND podcast_id = p_podcast_id
     RETURNING 1
  )
  SELECT count(*) INTO v_moved_mentions FROM moved;

  -- Move/upsert the podcast map row
  WITH del AS (
    DELETE FROM person_podcast_map
     WHERE person_id = p_alias_person_id AND podcast_id = p_podcast_id
     RETURNING role, confidence, episode_count, latest_episode_at
  ),
  ins AS (
    INSERT INTO person_podcast_map (person_id, podcast_id, role, confidence, episode_count, latest_episode_at)
    SELECT p_canonical_person_id, p_podcast_id, role, confidence, episode_count, latest_episode_at FROM del
    ON CONFLICT (person_id, podcast_id, role) DO UPDATE
      SET episode_count = person_podcast_map.episode_count + EXCLUDED.episode_count,
          latest_episode_at = GREATEST(person_podcast_map.latest_episode_at, EXCLUDED.latest_episode_at)
    RETURNING 1
  )
  SELECT count(*) INTO v_moved_map FROM ins;

  -- If alias person now has zero remaining links, mark as resolved
  UPDATE people SET
    identity_status = CASE
      WHEN NOT EXISTS (SELECT 1 FROM person_episode_mentions WHERE person_id = p_alias_person_id)
       AND NOT EXISTS (SELECT 1 FROM person_podcast_map WHERE person_id = p_alias_person_id)
      THEN 'merged_into'
      ELSE identity_status
    END,
    ai_duplicate_of_person_id = CASE
      WHEN NOT EXISTS (SELECT 1 FROM person_episode_mentions WHERE person_id = p_alias_person_id)
       AND NOT EXISTS (SELECT 1 FROM person_podcast_map WHERE person_id = p_alias_person_id)
      THEN p_canonical_person_id
      ELSE ai_duplicate_of_person_id
    END,
    is_public = CASE WHEN NOT EXISTS (SELECT 1 FROM person_episode_mentions WHERE person_id = p_alias_person_id)
                      AND NOT EXISTS (SELECT 1 FROM person_podcast_map WHERE person_id = p_alias_person_id)
                     THEN false ELSE is_public END,
    is_indexable = CASE WHEN NOT EXISTS (SELECT 1 FROM person_episode_mentions WHERE person_id = p_alias_person_id)
                         AND NOT EXISTS (SELECT 1 FROM person_podcast_map WHERE person_id = p_alias_person_id)
                        THEN false ELSE is_indexable END,
    is_browsable_in_people_hub = CASE WHEN NOT EXISTS (SELECT 1 FROM person_episode_mentions WHERE person_id = p_alias_person_id)
                                       AND NOT EXISTS (SELECT 1 FROM person_podcast_map WHERE person_id = p_alias_person_id)
                                      THEN false ELSE is_browsable_in_people_hub END,
    updated_at = now()
  WHERE id = p_alias_person_id;

  RETURN jsonb_build_object(
    'moved_mentions', v_moved_mentions,
    'moved_podcast_map', v_moved_map,
    'alias_person_id', p_alias_person_id,
    'canonical_person_id', p_canonical_person_id,
    'scope_podcast_id', p_podcast_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_scoped_person_alias(uuid,uuid,uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.upsert_scoped_person_alias(uuid,uuid,uuid,text) TO authenticated, service_role;
