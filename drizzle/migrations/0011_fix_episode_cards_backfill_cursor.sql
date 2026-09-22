-- max(uuid) does not exist in Postgres; take the last cursor row by ordering instead.
CREATE OR REPLACE FUNCTION public.episode_cards_backfill_tick()
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

  SELECT count(*)::int INTO copied FROM _ec_todo;
  SELECT id INTO max_id FROM _ec_todo ORDER BY id DESC LIMIT 1;

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