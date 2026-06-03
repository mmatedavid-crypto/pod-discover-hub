-- Consolidated Hungarian-only public AI text guard.
-- Public summaries and SEO text on Podiverzum must be Hungarian. This
-- migration is intentionally idempotent and restates the whole safety net so a
-- partially deployed environment still ends up with the function, trigger
-- functions, triggers and policy setting in place.

CREATE OR REPLACE FUNCTION public.is_hungarianish_public_ai_text(_text text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t text := lower(coalesce(_text, ''));
  words text[];
  total int;
  hu_hits int := 0;
  en_hits int := 0;
  dia_hits int := 0;
  w text;
  hu_ratio numeric;
  en_ratio numeric;
  dia_per100 numeric;
BEGIN
  IF _text IS NULL OR length(trim(_text)) < 20 THEN
    RETURN true;
  END IF;

  words := regexp_split_to_array(trim(regexp_replace(t, '[^[:alpha:]'']+', ' ', 'g')), '\s+');
  total := greatest(coalesce(array_length(words, 1), 0), 1);

  FOREACH w IN ARRAY words LOOP
    IF w = ANY (ARRAY[
      'és','hogy','a','az','egy','van','nem','mert','podcast','adás','adas','epizód','epizod',
      'beszélgetés','beszelgetes','magyar','témája','temaja','vendég','vendeg','műsor',
      'musor','hallgatók','hallgatok','szól','szol','bemutatja','körül','korul','kapcsolatban',
      'szerint','alapján','alapjan','közben','kozben','arról','arrol','erről','errol',
      'hazai','közéleti','kozeleti','gazdasági','gazdasagi','társadalmi','tarsadalmi'
    ]) THEN
      hu_hits := hu_hits + 1;
    ELSIF w = ANY (ARRAY[
      'the','and','of','to','in','is','for','on','with','that','this','are','was','were',
      'by','from','as','at','an','be','or','it','its','their','they','you','we','our',
      'your','has','have','had','but','not','which','also','more','than','these','those',
      'about','when','what','who','how','why','episode','discusses','explores','features',
      'conversation','interview','host','guest','listeners','summary'
    ]) THEN
      en_hits := en_hits + 1;
    END IF;
  END LOOP;

  dia_hits := length(t) - length(regexp_replace(t, '[áéíóöőúüű]', '', 'g'));
  hu_ratio := hu_hits::numeric / total::numeric;
  en_ratio := en_hits::numeric / total::numeric;
  dia_per100 := dia_hits::numeric / greatest(length(t), 1)::numeric * 100;

  IF en_ratio > 0.12 THEN
    RETURN false;
  END IF;

  IF en_ratio > 0.06 AND hu_ratio < 0.01 AND dia_per100 < 1.0 THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_hu_episode_public_ai_text()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ai_summary IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.ai_summary) THEN
    NEW.ai_summary := NULL;
    NEW.ai_summary_source := NULL;
  END IF;

  IF NEW.summary IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.summary) THEN
    NEW.summary := NULL;
  END IF;

  IF NEW.seo_title IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.seo_title) THEN
    NEW.seo_title := NULL;
  END IF;

  IF NEW.seo_description IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.seo_description) THEN
    NEW.seo_description := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_hu_episode_ai_summary ON public.episodes;
DROP TRIGGER IF EXISTS trg_enforce_hu_episode_public_ai_text ON public.episodes;
CREATE TRIGGER trg_enforce_hu_episode_public_ai_text
BEFORE INSERT OR UPDATE OF ai_summary, summary, seo_title, seo_description ON public.episodes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_hu_episode_public_ai_text();

CREATE OR REPLACE FUNCTION public.enforce_hu_podcast_public_ai_text()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.summary IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.summary) THEN
    NEW.summary := NULL;
  END IF;

  IF NEW.seo_title IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.seo_title) THEN
    NEW.seo_title := NULL;
  END IF;

  IF NEW.seo_description IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.seo_description) THEN
    NEW.seo_description := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_hu_podcast_public_ai_text ON public.podcasts;
CREATE TRIGGER trg_enforce_hu_podcast_public_ai_text
BEFORE INSERT OR UPDATE OF summary, seo_title, seo_description ON public.podcasts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_hu_podcast_public_ai_text();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'public_ai_language_guard_policy',
  jsonb_build_object(
    'version', 3,
    'language', 'hu',
    'applies_to', jsonb_build_array(
      'episodes.ai_summary',
      'episodes.summary',
      'episodes.seo_title',
      'episodes.seo_description',
      'podcasts.summary',
      'podcasts.seo_title',
      'podcasts.seo_description'
    ),
    'enforced_by', jsonb_build_array(
      'edge_hu_language_guard',
      'public.is_hungarianish_public_ai_text(text)',
      'trg_enforce_hu_episode_public_ai_text',
      'trg_enforce_hu_podcast_public_ai_text'
    ),
    'note', 'Public AI text on Podiverzum must be Hungarian. English-dominant fields are nulled by DB triggers and should be regenerated in Hungarian.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
