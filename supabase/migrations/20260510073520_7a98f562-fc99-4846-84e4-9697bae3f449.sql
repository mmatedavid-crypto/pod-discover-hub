
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Add plain columns (no GENERATED — trigger fills them)
ALTER TABLE public.episodes  ADD COLUMN IF NOT EXISTS search_text text;
ALTER TABLE public.episodes  ADD COLUMN IF NOT EXISTS search_tsv tsvector;
ALTER TABLE public.podcasts  ADD COLUMN IF NOT EXISTS search_text text;
ALTER TABLE public.podcasts  ADD COLUMN IF NOT EXISTS search_tsv tsvector;

-- Trigger function for episodes
CREATE OR REPLACE FUNCTION public.episodes_search_refresh()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.search_text := lower(
    coalesce(NEW.display_title, NEW.title, '') || ' ' ||
    coalesce(NEW.ai_summary, '') || ' ' ||
    coalesce(NEW.summary, '') || ' ' ||
    coalesce(array_to_string(NEW.topics, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.people, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.companies, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.ingredients, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.tickers, ' '), '')
  );
  NEW.search_tsv := to_tsvector('simple', NEW.search_text);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_episodes_search_refresh ON public.episodes;
CREATE TRIGGER trg_episodes_search_refresh
BEFORE INSERT OR UPDATE OF title, display_title, summary, ai_summary, topics, people, companies, ingredients, tickers
ON public.episodes
FOR EACH ROW EXECUTE FUNCTION public.episodes_search_refresh();

-- Trigger function for podcasts
CREATE OR REPLACE FUNCTION public.podcasts_search_refresh()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.search_text := lower(
    coalesce(NEW.display_title, NEW.title, '') || ' ' ||
    coalesce(NEW.seo_description, '') || ' ' ||
    coalesce(NEW.summary, '') || ' ' ||
    coalesce(NEW.category, '')
  );
  NEW.search_tsv := to_tsvector('simple', NEW.search_text);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_podcasts_search_refresh ON public.podcasts;
CREATE TRIGGER trg_podcasts_search_refresh
BEFORE INSERT OR UPDATE OF title, display_title, summary, seo_description, category
ON public.podcasts
FOR EACH ROW EXECUTE FUNCTION public.podcasts_search_refresh();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_episodes_search_tsv      ON public.episodes USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_episodes_search_text_trgm ON public.episodes USING GIN (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_podcasts_search_tsv      ON public.podcasts USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_podcasts_search_text_trgm ON public.podcasts USING GIN (search_text gin_trgm_ops);
