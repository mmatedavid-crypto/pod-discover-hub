-- The topic page's slowest input was a GIN containment scan over the wide
-- episode_ai_classifications.topics jsonb (5k heap blocks per topic, 10s cold).
-- Normalise it into a slim (slug, episode_id) map so the topic list is an index scan.
CREATE TABLE IF NOT EXISTS public.episode_topic_slug_map (
  slug text NOT NULL,
  episode_id uuid NOT NULL,
  confidence numeric,
  PRIMARY KEY (slug, episode_id)
);
CREATE INDEX IF NOT EXISTS idx_etsm_episode ON public.episode_topic_slug_map (episode_id);

GRANT SELECT ON public.episode_topic_slug_map TO anon, authenticated;
GRANT ALL ON public.episode_topic_slug_map TO service_role;
ALTER TABLE public.episode_topic_slug_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read episode topic slug map" ON public.episode_topic_slug_map;
CREATE POLICY "public read episode topic slug map"
  ON public.episode_topic_slug_map FOR SELECT USING (true);

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
    SELECT t->>'slug', NEW.episode_id, nullif(t->>'confidence', '')::numeric
    FROM jsonb_array_elements(NEW.topics) AS t
    WHERE coalesce(t->>'slug', '') <> ''
    ON CONFLICT (slug, episode_id) DO UPDATE SET confidence = excluded.confidence;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS episode_topic_slug_map_trg ON public.episode_ai_classifications;
CREATE TRIGGER episode_topic_slug_map_trg
  AFTER INSERT OR UPDATE OF topics, classification_status
  ON public.episode_ai_classifications
  FOR EACH ROW EXECUTE FUNCTION public.episode_topic_slug_map_sync();

CREATE TABLE IF NOT EXISTS public.episode_topic_slug_backfill_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_id uuid,
  done boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.episode_topic_slug_backfill_state (id) VALUES (true)
ON CONFLICT (id) DO UPDATE SET last_id = NULL, done = false, updated_at = now();
GRANT ALL ON public.episode_topic_slug_backfill_state TO service_role;
ALTER TABLE public.episode_topic_slug_backfill_state ENABLE ROW LEVEL SECURITY;

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
  SELECT t->>'slug', d.episode_id, nullif(t->>'confidence', '')::numeric
  FROM _etsm_todo d, jsonb_array_elements(d.topics) AS t
  WHERE coalesce(t->>'slug', '') <> ''
  ON CONFLICT (slug, episode_id) DO UPDATE SET confidence = excluded.confidence;

  SELECT count(*)::int INTO seen FROM _etsm_todo;
  SELECT episode_id INTO max_id FROM _etsm_todo ORDER BY episode_id DESC LIMIT 1;

  IF max_id IS NULL THEN
    UPDATE public.episode_topic_slug_backfill_state SET done = true, updated_at = now() WHERE id;
    PERFORM cron.unschedule('episode-topic-slug-backfill');
  ELSE
    UPDATE public.episode_topic_slug_backfill_state SET last_id = max_id, updated_at = now() WHERE id;
  END IF;

  PERFORM pg_advisory_unlock(771122335);
  RETURN seen;
END;
$$;