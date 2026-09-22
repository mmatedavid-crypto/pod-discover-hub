-- The episodes table is very wide (58 columns, multi-GB heap), so listing even
-- 500 episodes means 500 random wide-row heap fetches -> 10-15s on a Small
-- instance. episode_cards is a slim projection holding only the fields the
-- episode cards render, kept in sync by trigger. It fits in cache, so list
-- pages (topic, person, podcast) stay fast.

CREATE TABLE IF NOT EXISTS public.episode_cards (
  episode_id uuid PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
  podcast_id uuid,
  slug text,
  title text,
  display_title text,
  image_url text,
  audio_url text,
  published_at timestamptz,
  card_summary text,
  people text[],
  mentioned text[],
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS episode_cards_podcast_published_idx
  ON public.episode_cards (podcast_id, published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS episode_cards_published_idx
  ON public.episode_cards (published_at DESC NULLS LAST);

GRANT SELECT ON public.episode_cards TO anon, authenticated;
GRANT ALL ON public.episode_cards TO service_role;

ALTER TABLE public.episode_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "episode_cards public read" ON public.episode_cards;
CREATE POLICY "episode_cards public read"
  ON public.episode_cards FOR SELECT
  USING (true);

CREATE OR REPLACE FUNCTION public.episode_cards_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.episode_cards AS c (
    episode_id, podcast_id, slug, title, display_title, image_url, audio_url,
    published_at, card_summary, people, mentioned, updated_at
  ) VALUES (
    NEW.id, NEW.podcast_id, NEW.slug, NEW.title, NEW.display_title, NEW.image_url,
    NEW.audio_url, NEW.published_at,
    left(coalesce(NEW.ai_summary, NEW.summary, ''), 400),
    NEW.people, NEW.mentioned, now()
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
    updated_at = now();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS episode_cards_sync_trg ON public.episodes;
CREATE TRIGGER episode_cards_sync_trg
  AFTER INSERT OR UPDATE OF title, display_title, slug, image_url, audio_url,
    published_at, ai_summary, summary, people, mentioned, podcast_id
  ON public.episodes
  FOR EACH ROW EXECUTE FUNCTION public.episode_cards_sync();

-- Batched backfill helper: returns the number of rows copied.
CREATE OR REPLACE FUNCTION public.episode_cards_backfill(_batch integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  copied integer;
BEGIN
  WITH todo AS (
    SELECT e.id FROM public.episodes e
    LEFT JOIN public.episode_cards c ON c.episode_id = e.id
    WHERE c.episode_id IS NULL
    LIMIT greatest(1, least(coalesce(_batch, 5000), 20000))
  )
  INSERT INTO public.episode_cards (
    episode_id, podcast_id, slug, title, display_title, image_url, audio_url,
    published_at, card_summary, people, mentioned
  )
  SELECT e.id, e.podcast_id, e.slug, e.title, e.display_title, e.image_url, e.audio_url,
         e.published_at, left(coalesce(e.ai_summary, e.summary, ''), 400), e.people, e.mentioned
  FROM public.episodes e JOIN todo ON todo.id = e.id
  ON CONFLICT (episode_id) DO NOTHING;
  GET DIAGNOSTICS copied = ROW_COUNT;
  RETURN copied;
END;
$$;

GRANT EXECUTE ON FUNCTION public.episode_cards_backfill(integer) TO service_role;