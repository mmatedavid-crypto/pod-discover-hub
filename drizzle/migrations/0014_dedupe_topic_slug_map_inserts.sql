-- A single episode can list the same topic slug twice in its AI classification;
-- deduplicate before inserting so ON CONFLICT does not hit the same row twice.
CREATE OR REPLACE FUNCTION public.episode_topic_slug_map_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.episode_topic_slug_map WHERE episode_id = NEW.episode_id;
  IF NEW.classification_status = 'classified' AND NEW.topics IS NOT NULL THEN
    INSERT INTO public.episode_topic_slug_map (slug, episode_id, confidence)
    SELECT DISTINCT ON (slug) slug, NEW.episode_id, confidence
    FROM (
      SELECT t->>'slug' AS slug, nullif(t->>'confidence', '')::numeric AS confidence
      FROM jsonb_array_elements(NEW.topics) AS t
      WHERE coalesce(t->>'slug', '') <> ''
    ) s
    ORDER BY slug, confidence DESC NULLS LAST
    ON CONFLICT (slug, episode_id) DO UPDATE SET confidence = excluded.confidence;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.episode_topic_slug_backfill_tick()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '150s'
AS $$
DECLARE
  cursor_id uuid;
  max_id uuid;
  seen integer := 0;
BEGIN
  IF NOT pg_try_advisory_lock(771122335) THEN
    RETURN -1;
  END IF;

  SELECT last_id INTO cursor_id FROM public.episode_topic_slug_backfill_state WHERE id;

  DROP TABLE IF EXISTS _etsm_todo;
  CREATE TEMP TABLE _etsm_todo ON COMMIT DROP AS
    SELECT c.episode_id, c.topics
    FROM public.episode_ai_classifications c
    WHERE c.classification_status = 'classified'
      AND (cursor_id IS NULL OR c.episode_id > cursor_id)
    ORDER BY c.episode_id
    LIMIT 4000;

  INSERT INTO public.episode_topic_slug_map (slug, episode_id, confidence)
  SELECT DISTINCT ON (episode_id, slug) slug, episode_id, confidence
  FROM (
    SELECT d.episode_id, t->>'slug' AS slug, nullif(t->>'confidence', '')::numeric AS confidence
    FROM _etsm_todo d, jsonb_array_elements(d.topics) AS t
    WHERE coalesce(t->>'slug', '') <> ''
  ) s
  ORDER BY episode_id, slug, confidence DESC NULLS LAST
  ON CONFLICT (slug, episode_id) DO UPDATE SET confidence = excluded.confidence;

  SELECT count(*)::int INTO seen FROM _etsm_todo;
  SELECT episode_id INTO max_id FROM _etsm_todo ORDER BY episode_id DESC LIMIT 1;

  IF max_id IS NULL THEN
    UPDATE public.episode_topic_slug_backfill_state SET done = true, updated_at = now() WHERE id;
  ELSE
    UPDATE public.episode_topic_slug_backfill_state SET last_id = max_id, updated_at = now() WHERE id;
  END IF;

  PERFORM pg_advisory_unlock(771122335);
  RETURN seen;
END;
$$;