-- Strengthen the Hungarian-only public AI text guard with English podcast/SEO
-- phrase detection. This catches polished English summaries that have sparse
-- stopword signal but still read as English public copy.

CREATE OR REPLACE FUNCTION public.is_hungarianish_public_ai_text(_text text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  raw text := coalesce(_text, '');
  t text := lower(coalesce(_text, ''));
  words text[];
  total int;
  hu_hits int := 0;
  en_hits int := 0;
  phrase_hits int := 0;
  dia_hits int := 0;
  w text;
  hu_ratio numeric;
  en_ratio numeric;
  dia_per100 numeric;
  has_hu_signal boolean;
BEGIN
  IF _text IS NULL OR length(trim(_text)) < 20 THEN
    RETURN true;
  END IF;

  phrase_hits :=
    (CASE WHEN raw ~* '(^|[^[:alpha:]])this[[:space:]]+episode([^[:alpha:]]|$)' THEN 1 ELSE 0 END) +
    (CASE WHEN raw ~* '(^|[^[:alpha:]])in[[:space:]]+this[[:space:]]+episode([^[:alpha:]]|$)' THEN 1 ELSE 0 END) +
    (CASE WHEN raw ~* '(^|[^[:alpha:]])the[[:space:]]+episode([^[:alpha:]]|$)' THEN 1 ELSE 0 END) +
    (CASE WHEN raw ~* '(^|[^[:alpha:]])the[[:space:]]+conversation([^[:alpha:]]|$)' THEN 1 ELSE 0 END) +
    (CASE WHEN raw ~* '(^|[^[:alpha:]])this[[:space:]]+conversation([^[:alpha:]]|$)' THEN 1 ELSE 0 END) +
    (CASE WHEN raw ~* '(^|[^[:alpha:]])hosted[[:space:]]+by([^[:alpha:]]|$)' THEN 1 ELSE 0 END) +
    (CASE WHEN raw ~* '(^|[^[:alpha:]])features?[[:space:]]+(a[[:space:]]+)?(conversation|discussion|interview)([^[:alpha:]]|$)' THEN 1 ELSE 0 END) +
    (CASE WHEN raw ~* '(^|[^[:alpha:]])explores?[[:space:]]+(how|why|what|the)([^[:alpha:]]|$)' THEN 1 ELSE 0 END) +
    (CASE WHEN raw ~* '(^|[^[:alpha:]])discuss(es|ing)?[[:space:]]+(the|how|why|what)([^[:alpha:]]|$)' THEN 1 ELSE 0 END) +
    (CASE WHEN raw ~* '(^|[^[:alpha:]])listeners?[[:space:]]+(will|can|learn|hear)([^[:alpha:]]|$)' THEN 1 ELSE 0 END) +
    (CASE WHEN raw ~* '(^|[^[:alpha:]])key[[:space:]]+(takeaways|themes|insights)([^[:alpha:]]|$)' THEN 1 ELSE 0 END) +
    (CASE WHEN raw ~* '(^|[^[:alpha:]])latest[[:space:]]+(market|news|trends|developments)([^[:alpha:]]|$)' THEN 1 ELSE 0 END) +
    (CASE WHEN raw ~* '(^|[^[:alpha:]])what[[:space:]]+(investors|listeners|viewers|audiences)[[:space:]]+should([^[:alpha:]]|$)' THEN 1 ELSE 0 END);

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
  has_hu_signal := hu_ratio >= 0.02 OR dia_per100 >= 1.2;

  IF phrase_hits >= 2 AND NOT has_hu_signal THEN
    RETURN false;
  END IF;

  IF phrase_hits >= 1 AND en_ratio > 0.05 AND NOT has_hu_signal THEN
    RETURN false;
  END IF;

  IF en_ratio > 0.12 THEN
    RETURN false;
  END IF;

  IF en_ratio > 0.06 AND hu_ratio < 0.01 AND dia_per100 < 1.0 THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE TEMP TABLE tmp_non_hu_episode_public_text_v4 AS
SELECT e.id
FROM public.episodes e
JOIN public.podcasts p ON p.id = e.podcast_id
WHERE p.language_decision = 'accept_hungarian'
  AND (
    (e.ai_summary IS NOT NULL AND length(trim(e.ai_summary)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.ai_summary))
    OR (e.summary IS NOT NULL AND length(trim(e.summary)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.summary))
    OR (e.seo_title IS NOT NULL AND length(trim(e.seo_title)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.seo_title))
    OR (e.seo_description IS NOT NULL AND length(trim(e.seo_description)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.seo_description))
  );

CREATE TEMP TABLE tmp_non_hu_podcast_public_text_v4 AS
SELECT p.id
FROM public.podcasts p
WHERE p.language_decision = 'accept_hungarian'
  AND (
    (p.summary IS NOT NULL AND length(trim(p.summary)) >= 20 AND NOT public.is_hungarianish_public_ai_text(p.summary))
    OR (p.seo_title IS NOT NULL AND length(trim(p.seo_title)) >= 20 AND NOT public.is_hungarianish_public_ai_text(p.seo_title))
    OR (p.seo_description IS NOT NULL AND length(trim(p.seo_description)) >= 20 AND NOT public.is_hungarianish_public_ai_text(p.seo_description))
  );

UPDATE public.episodes e
SET
  ai_summary = CASE
    WHEN e.ai_summary IS NOT NULL AND length(trim(e.ai_summary)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.ai_summary)
    THEN NULL ELSE e.ai_summary END,
  ai_summary_source = CASE
    WHEN e.ai_summary IS NOT NULL AND length(trim(e.ai_summary)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.ai_summary)
    THEN NULL ELSE e.ai_summary_source END,
  summary = CASE
    WHEN e.summary IS NOT NULL AND length(trim(e.summary)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.summary)
    THEN NULL ELSE e.summary END,
  seo_title = CASE
    WHEN e.seo_title IS NOT NULL AND length(trim(e.seo_title)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.seo_title)
    THEN NULL ELSE e.seo_title END,
  seo_description = CASE
    WHEN e.seo_description IS NOT NULL AND length(trim(e.seo_description)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.seo_description)
    THEN NULL ELSE e.seo_description END,
  ai_enriched_at = NULL
FROM tmp_non_hu_episode_public_text_v4 bad
WHERE bad.id = e.id;

UPDATE public.podcasts p
SET
  summary = CASE
    WHEN p.summary IS NOT NULL AND length(trim(p.summary)) >= 20 AND NOT public.is_hungarianish_public_ai_text(p.summary)
    THEN NULL ELSE p.summary END,
  seo_title = CASE
    WHEN p.seo_title IS NOT NULL AND length(trim(p.seo_title)) >= 20 AND NOT public.is_hungarianish_public_ai_text(p.seo_title)
    THEN NULL ELSE p.seo_title END,
  seo_description = CASE
    WHEN p.seo_description IS NOT NULL AND length(trim(p.seo_description)) >= 20 AND NOT public.is_hungarianish_public_ai_text(p.seo_description)
    THEN NULL ELSE p.seo_description END,
  ai_enriched_at = NULL
FROM tmp_non_hu_podcast_public_text_v4 bad
WHERE bad.id = p.id;

INSERT INTO public.ai_enrichment_jobs (kind, target_type, target_id, priority, input_hash, status, result)
SELECT
  'seo_episode',
  'episode',
  bad.id,
  100,
  md5('non_hu_public_text_repair_episode_v4:' || bad.id::text),
  'pending',
  jsonb_build_object('reason', 'non_hu_public_text_repair', 'source', 'migration_20260605010000')
FROM tmp_non_hu_episode_public_text_v4 bad
ON CONFLICT (kind, target_type, target_id, input_hash) DO NOTHING;

INSERT INTO public.ai_enrichment_jobs (kind, target_type, target_id, priority, input_hash, status, result)
SELECT
  'seo_podcast',
  'podcast',
  bad.id,
  100,
  md5('non_hu_public_text_repair_podcast_v4:' || bad.id::text),
  'pending',
  jsonb_build_object('reason', 'non_hu_public_text_repair', 'source', 'migration_20260605010000')
FROM tmp_non_hu_podcast_public_text_v4 bad
ON CONFLICT (kind, target_type, target_id, input_hash) DO NOTHING;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'public_ai_language_guard_policy',
  jsonb_build_object(
    'version', 4,
    'language', 'hu',
    'english_phrase_guard', true,
    'repair_job_source', 'migration_20260605010000',
    'note', 'Public AI text on Podiverzum must be Hungarian. V4 catches polished English podcast/SEO phrases and requeues only affected rows.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

DROP TABLE IF EXISTS tmp_non_hu_episode_public_text_v4;
DROP TABLE IF EXISTS tmp_non_hu_podcast_public_text_v4;
