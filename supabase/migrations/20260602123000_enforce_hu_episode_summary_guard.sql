-- Close the remaining public-AI-text gap: ai-enrich writes episodes.summary,
-- while the earlier guard covered episodes.ai_summary and SEO fields.

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

DROP TRIGGER IF EXISTS trg_enforce_hu_episode_public_ai_text ON public.episodes;
CREATE TRIGGER trg_enforce_hu_episode_public_ai_text
BEFORE INSERT OR UPDATE OF ai_summary, summary, seo_title, seo_description ON public.episodes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_hu_episode_public_ai_text();

UPDATE public.episodes e
SET summary = NULL
FROM public.podcasts p
WHERE p.id = e.podcast_id
  AND p.is_hungarian = TRUE
  AND p.language_decision = 'accept_hungarian'
  AND e.summary IS NOT NULL
  AND length(trim(e.summary)) > 80
  AND NOT public.is_hungarianish_public_ai_text(e.summary);
