-- lovable-cron-fallback-reviewed: one-off keyset backfill of episode_cards, every 5 minutes, unschedules itself when it reaches the end (~50 runs)
DO $$
BEGIN
  PERFORM cron.unschedule('episode-cards-backfill');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

ALTER TABLE public.episode_cards
  ADD COLUMN IF NOT EXISTS topics text[],
  ADD COLUMN IF NOT EXISTS companies text[],
  ADD COLUMN IF NOT EXISTS tickers text[];

TRUNCATE public.episode_cards;

CREATE TABLE IF NOT EXISTS public.episode_cards_backfill_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_id uuid,
  done boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.episode_cards_backfill_state (id) VALUES (true)
ON CONFLICT (id) DO UPDATE SET last_id = NULL, done = false, updated_at = now();

GRANT ALL ON public.episode_cards_backfill_state TO service_role;
ALTER TABLE public.episode_cards_backfill_state ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.episode_cards_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.episode_cards AS c (
    episode_id, podcast_id, slug, title, display_title, image_url, audio_url,
    published_at, card_summary, people, mentioned, topics, companies, tickers, updated_at
  ) VALUES (
    NEW.id, NEW.podcast_id, NEW.slug, NEW.title, NEW.display_title, NEW.image_url,
    NEW.audio_url, NEW.published_at,
    left(coalesce(NEW.ai_summary, NEW.summary, ''), 400),
    NEW.people, NEW.mentioned, NEW.topics, NEW.companies, NEW.tickers, now()
  )
  ON CONFLICT (episode_id) DO UPDATE SET
    podcast_id = excluded.podcast_id,
    slug = excluded.slug,
    title = excluded.title,
    display_title = excluded.display_title,
    image_url = excluded.image_url,
    audio_url = excluded.audio_url,
    published_at = excluded.published_at,
    card_summary = excluded.card_summary,
    people = excluded.people,
    mentioned = excluded.mentioned,
    topics = excluded.topics,
    companies = excluded.companies,
    tickers = excluded.tickers,
    updated_at = now();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS episode_cards_sync_trg ON public.episodes;
CREATE TRIGGER episode_cards_sync_trg
  AFTER INSERT OR UPDATE OF title, display_title, slug, image_url, audio_url,
    published_at, ai_summary, summary, people, mentioned, topics, companies,
    tickers, podcast_id
  ON public.episodes
  FOR EACH ROW EXECUTE FUNCTION public.episode_cards_sync();

DROP FUNCTION IF EXISTS public.episode_cards_backfill_tick();
DROP FUNCTION IF EXISTS public.episode_cards_backfill(integer);

CREATE FUNCTION public.episode_cards_backfill_tick()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '150s'
AS $$
DECLARE
  cursor_id uuid;
  max_id uuid;
  copied integer := 0;
BEGIN
  IF NOT pg_try_advisory_lock(771122334) THEN
    RETURN -1;
  END IF;

  SELECT last_id INTO cursor_id FROM public.episode_cards_backfill_state WHERE id;

  CREATE TEMP TABLE _ec_todo ON COMMIT DROP AS
    SELECT e.id, e.podcast_id, e.slug, e.title, e.display_title, e.image_url, e.audio_url,
           e.published_at, left(coalesce(e.ai_summary, e.summary, ''), 400) AS card_summary,
           e.people, e.mentioned, e.topics, e.companies, e.tickers
    FROM public.episodes e
    WHERE cursor_id IS NULL OR e.id > cursor_id
    ORDER BY e.id
    LIMIT 3000;

  INSERT INTO public.episode_cards (
    episode_id, podcast_id, slug, title, display_title, image_url, audio_url,
    published_at, card_summary, people, mentioned, topics, companies, tickers
  )
  SELECT id, podcast_id, slug, title, display_title, image_url, audio_url,
         published_at, card_summary, people, mentioned, topics, companies, tickers
  FROM _ec_todo
  ON CONFLICT (episode_id) DO NOTHING;

  SELECT count(*)::int, max(id) INTO copied, max_id FROM _ec_todo;

  IF max_id IS NULL THEN
    UPDATE public.episode_cards_backfill_state SET done = true, updated_at = now() WHERE id;
    PERFORM cron.unschedule('episode-cards-backfill');
  ELSE
    UPDATE public.episode_cards_backfill_state SET last_id = max_id, updated_at = now() WHERE id;
  END IF;

  PERFORM pg_advisory_unlock(771122334);
  RETURN copied;
END;
$$;

SELECT cron.schedule('episode-cards-backfill', '*/5 * * * *', $$SELECT public.episode_cards_backfill_tick();$$);