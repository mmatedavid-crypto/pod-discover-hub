-- Podiverzum public AI-written SEO text must be Hungarian as well.
-- Applies to podcast and episode SEO fields, not only episode ai_summary.

CREATE OR REPLACE FUNCTION public.enforce_hu_episode_public_ai_text()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ai_summary IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.ai_summary) THEN
    NEW.ai_summary := NULL;
    NEW.ai_summary_source := NULL;
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

DROP TRIGGER IF EXISTS trg_enforce_hu_episode_ai_summary ON public.episodes;
DROP TRIGGER IF EXISTS trg_enforce_hu_episode_public_ai_text ON public.episodes;
CREATE TRIGGER trg_enforce_hu_episode_public_ai_text
BEFORE INSERT OR UPDATE OF ai_summary, seo_title, seo_description ON public.episodes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_hu_episode_public_ai_text();

DROP TRIGGER IF EXISTS trg_enforce_hu_podcast_public_ai_text ON public.podcasts;
CREATE TRIGGER trg_enforce_hu_podcast_public_ai_text
BEFORE INSERT OR UPDATE OF summary, seo_title, seo_description ON public.podcasts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_hu_podcast_public_ai_text();

UPDATE public.episodes
SET
  ai_summary = CASE WHEN ai_summary IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(ai_summary) THEN NULL ELSE ai_summary END,
  ai_summary_source = CASE WHEN ai_summary IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(ai_summary) THEN NULL ELSE ai_summary_source END,
  seo_title = CASE WHEN seo_title IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(seo_title) THEN NULL ELSE seo_title END,
  seo_description = CASE WHEN seo_description IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(seo_description) THEN NULL ELSE seo_description END
WHERE
  (ai_summary IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(ai_summary))
  OR (seo_title IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(seo_title))
  OR (seo_description IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(seo_description));

UPDATE public.podcasts
SET
  summary = CASE WHEN summary IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(summary) THEN NULL ELSE summary END,
  seo_title = CASE WHEN seo_title IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(seo_title) THEN NULL ELSE seo_title END,
  seo_description = CASE WHEN seo_description IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(seo_description) THEN NULL ELSE seo_description END
WHERE
  (summary IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(summary))
  OR (seo_title IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(seo_title))
  OR (seo_description IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(seo_description));

