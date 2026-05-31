-- Public AI summaries on Podiverzum must be Hungarian. Always.
-- This DB-side guard is the final safety net behind the edge-function prompts.

CREATE OR REPLACE FUNCTION public.is_hungarianish_public_ai_text(_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    _text IS NULL
    OR length(trim(_text)) < 20
    OR _text ~ '[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]'
    OR _text ~* '\m(és|hogy|az|egy|van|nem|mert|podcast|adás|epizód|beszélgetés|magyar|témája|vendég|műsor|hallgatók|szól|bemutatja)\M'
    OR NOT (_text ~* '\m(the|and|of|to|in|with|this|that|episode|podcast|discusses|explores|features|conversation|interview|about|host|guest|listeners)\M');
$$;

CREATE OR REPLACE FUNCTION public.enforce_hu_episode_ai_summary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ai_summary IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.ai_summary) THEN
    NEW.ai_summary := NULL;
    NEW.ai_summary_source := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_hu_episode_ai_summary ON public.episodes;
CREATE TRIGGER trg_enforce_hu_episode_ai_summary
BEFORE INSERT OR UPDATE OF ai_summary ON public.episodes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_hu_episode_ai_summary();

