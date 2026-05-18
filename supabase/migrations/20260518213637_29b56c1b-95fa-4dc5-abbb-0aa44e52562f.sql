
CREATE OR REPLACE FUNCTION public.backfill_mentions_from_people_array(
  p_person_ids uuid[] DEFAULT NULL,
  p_dry_run boolean DEFAULT true
) RETURNS TABLE(inserted_count integer, person_count integer, sample jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
  v_persons integer := 0;
  v_sample jsonb;
BEGIN
  -- Build candidate set: HU episodes whose people[] contains a name matching
  -- a target person (by name or alias), where no mention row exists yet.
  WITH targets AS (
    SELECT p.id AS person_id, p.name AS canonical_name, p.normalized_name
    FROM people p
    WHERE (p_person_ids IS NULL OR p.id = ANY(p_person_ids))
  ),
  alias_names AS (
    SELECT t.person_id, lower(unnest(array_append(
      COALESCE((SELECT array_agg(pa.alias) FROM person_aliases pa WHERE pa.person_id = t.person_id), '{}'::text[]),
      t.canonical_name
    ))) AS name_lc
    FROM targets t
  ),
  candidates AS (
    SELECT DISTINCT t.person_id, e.id AS episode_id, e.podcast_id
    FROM episodes e
    JOIN podcasts pod ON pod.id = e.podcast_id
    JOIN LATERAL unnest(e.people) AS pname ON true
    JOIN alias_names an ON an.name_lc = lower(pname)
    JOIN targets t ON t.person_id = an.person_id
    WHERE pod.language ILIKE 'hu%'
      AND e.ai_entities_version >= 1
      AND NOT EXISTS (
        SELECT 1 FROM person_episode_mentions pem
        WHERE pem.person_id = t.person_id AND pem.episode_id = e.id
      )
  ),
  ins AS (
    INSERT INTO person_episode_mentions (
      person_id, episode_id, podcast_id, mention_type, confidence,
      source, relevance_status, evidence
    )
    SELECT c.person_id, c.episode_id, c.podcast_id, 'subject', 0.7,
           'people_array_backfill', 'pending', 'episodes.people[] match'
    FROM candidates c
    WHERE NOT p_dry_run
    RETURNING 1
  ),
  cand_stats AS (
    SELECT count(*)::int AS cnt, count(DISTINCT person_id)::int AS pcnt FROM candidates
  )
  SELECT
    CASE WHEN p_dry_run THEN cs.cnt ELSE (SELECT count(*)::int FROM ins) END,
    cs.pcnt,
    (SELECT jsonb_agg(jsonb_build_object('person_id', c.person_id, 'episode_id', c.episode_id))
     FROM (SELECT * FROM candidates LIMIT 5) c)
  INTO v_inserted, v_persons, v_sample
  FROM cand_stats cs;

  RETURN QUERY SELECT v_inserted, v_persons, COALESCE(v_sample, '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.backfill_mentions_from_people_array(uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_mentions_from_people_array(uuid[], boolean) TO service_role;
