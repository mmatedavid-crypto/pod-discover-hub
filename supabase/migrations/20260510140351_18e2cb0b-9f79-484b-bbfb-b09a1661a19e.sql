
-- Search v2 Step 1: unaccent integration into search_text triggers
-- Makes "Beyoncé"/"Beyonce", "Pelé"/"Pele", "café"/"cafe" all match.
-- Episodes: also adds parent podcast title + category context (Step 2 combined).

CREATE OR REPLACE FUNCTION public.episodes_search_refresh()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_pod_title text;
  v_pod_category text;
BEGIN
  -- Pull parent podcast context for richer matching
  SELECT coalesce(display_title, title, ''), coalesce(category, '')
    INTO v_pod_title, v_pod_category
  FROM podcasts WHERE id = NEW.podcast_id;

  NEW.search_text := lower(unaccent(
    coalesce(NEW.display_title, NEW.title, '') || ' ' ||
    coalesce(NEW.ai_summary, '') || ' ' ||
    coalesce(NEW.summary, '') || ' ' ||
    coalesce(array_to_string(NEW.topics, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.people, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.companies, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.ingredients, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.tickers, ' '), '') || ' ' ||
    coalesce(v_pod_title, '') || ' ' ||
    coalesce(v_pod_category, '')
  ));
  NEW.search_tsv := to_tsvector('simple', NEW.search_text);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.podcasts_search_refresh()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.search_text := lower(unaccent(
    coalesce(NEW.display_title, NEW.title, '') || ' ' ||
    coalesce(NEW.seo_description, '') || ' ' ||
    coalesce(NEW.summary, '') || ' ' ||
    coalesce(NEW.category, '')
  ));
  NEW.search_tsv := to_tsvector('simple', NEW.search_text);
  RETURN NEW;
END $function$;
