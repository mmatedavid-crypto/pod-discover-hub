-- Replace accidental English public AI text with regenerated Hungarian output.
-- This migration is intentionally self-contained: some environments may not yet
-- have the earlier language-guard function deployed.

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

CREATE TEMP TABLE tmp_non_hu_episode_public_text AS
SELECT e.id, e.podcast_id
FROM public.episodes e
JOIN public.podcasts p ON p.id = e.podcast_id
WHERE p.is_hungarian = TRUE
  AND p.language_decision = 'accept_hungarian'
  AND (
    (e.ai_summary IS NOT NULL AND length(trim(e.ai_summary)) > 80 AND NOT public.is_hungarianish_public_ai_text(e.ai_summary))
    OR (e.summary IS NOT NULL AND length(trim(e.summary)) > 80 AND NOT public.is_hungarianish_public_ai_text(e.summary))
    OR (e.seo_title IS NOT NULL AND length(trim(e.seo_title)) > 20 AND NOT public.is_hungarianish_public_ai_text(e.seo_title))
    OR (e.seo_description IS NOT NULL AND length(trim(e.seo_description)) > 80 AND NOT public.is_hungarianish_public_ai_text(e.seo_description))
  );

CREATE TEMP TABLE tmp_non_hu_podcast_public_text AS
SELECT p.id
FROM public.podcasts p
WHERE p.is_hungarian = TRUE
  AND p.language_decision = 'accept_hungarian'
  AND (
    (p.summary IS NOT NULL AND length(trim(p.summary)) > 80 AND NOT public.is_hungarianish_public_ai_text(p.summary))
    OR (p.seo_title IS NOT NULL AND length(trim(p.seo_title)) > 20 AND NOT public.is_hungarianish_public_ai_text(p.seo_title))
    OR (p.seo_description IS NOT NULL AND length(trim(p.seo_description)) > 80 AND NOT public.is_hungarianish_public_ai_text(p.seo_description))
  );

UPDATE public.episodes e
SET
  ai_summary = CASE
    WHEN e.ai_summary IS NOT NULL AND length(trim(e.ai_summary)) > 80 AND NOT public.is_hungarianish_public_ai_text(e.ai_summary)
    THEN NULL ELSE e.ai_summary END,
  ai_summary_source = CASE
    WHEN e.ai_summary IS NOT NULL AND length(trim(e.ai_summary)) > 80 AND NOT public.is_hungarianish_public_ai_text(e.ai_summary)
    THEN NULL ELSE e.ai_summary_source END,
  summary = CASE
    WHEN e.summary IS NOT NULL AND length(trim(e.summary)) > 80 AND NOT public.is_hungarianish_public_ai_text(e.summary)
    THEN NULL ELSE e.summary END,
  seo_title = CASE
    WHEN e.seo_title IS NOT NULL AND length(trim(e.seo_title)) > 20 AND NOT public.is_hungarianish_public_ai_text(e.seo_title)
    THEN NULL ELSE e.seo_title END,
  seo_description = CASE
    WHEN e.seo_description IS NOT NULL AND length(trim(e.seo_description)) > 80 AND NOT public.is_hungarianish_public_ai_text(e.seo_description)
    THEN NULL ELSE e.seo_description END,
  ai_enriched_at = NULL
FROM tmp_non_hu_episode_public_text bad
WHERE bad.id = e.id;

UPDATE public.podcasts p
SET
  summary = CASE
    WHEN p.summary IS NOT NULL AND length(trim(p.summary)) > 80 AND NOT public.is_hungarianish_public_ai_text(p.summary)
    THEN NULL ELSE p.summary END,
  seo_title = CASE
    WHEN p.seo_title IS NOT NULL AND length(trim(p.seo_title)) > 20 AND NOT public.is_hungarianish_public_ai_text(p.seo_title)
    THEN NULL ELSE p.seo_title END,
  seo_description = CASE
    WHEN p.seo_description IS NOT NULL AND length(trim(p.seo_description)) > 80 AND NOT public.is_hungarianish_public_ai_text(p.seo_description)
    THEN NULL ELSE p.seo_description END,
  ai_enriched_at = NULL
FROM tmp_non_hu_podcast_public_text bad
WHERE bad.id = p.id;

INSERT INTO public.ai_enrichment_jobs (kind, target_type, target_id, priority, input_hash, status, result)
SELECT
  'seo_episode',
  'episode',
  bad.id,
  100,
  md5('non_hu_public_text_repair_episode_v1:' || bad.id::text),
  'pending',
  jsonb_build_object('reason', 'non_hu_public_text_repair', 'source', 'migration_20260602123000')
FROM tmp_non_hu_episode_public_text bad
ON CONFLICT (kind, target_type, target_id, input_hash) DO NOTHING;

INSERT INTO public.ai_enrichment_jobs (kind, target_type, target_id, priority, input_hash, status, result)
SELECT
  'seo_podcast',
  'podcast',
  bad.id,
  100,
  md5('non_hu_public_text_repair_podcast_v1:' || bad.id::text),
  'pending',
  jsonb_build_object('reason', 'non_hu_public_text_repair', 'source', 'migration_20260602123000')
FROM tmp_non_hu_podcast_public_text bad
ON CONFLICT (kind, target_type, target_id, input_hash) DO NOTHING;

DROP TABLE IF EXISTS tmp_non_hu_episode_public_text;
DROP TABLE IF EXISTS tmp_non_hu_podcast_public_text;
