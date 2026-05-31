-- Enforce the intended text pipeline:
-- RSS/YouTube best source -> deterministic clean text -> embeddings/search.
-- The embedding runner must not silently re-clean raw RSS descriptions.

CREATE OR REPLACE FUNCTION public.select_embed_chunks_candidates(_model text, _limit integer)
 RETURNS TABLE(
  id uuid,
  podcast_id uuid,
  title text,
  display_title text,
  ai_summary text,
  description text,
  cleaned_text text,
  clean_source_hash text,
  cleaner_method text,
  topics text[],
  people text[],
  companies text[],
  tickers text[],
  ingredients text[],
  podcast_title text,
  podcast_display_title text,
  podcast_language text,
  podcast_tier text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH done AS (
    SELECT episode_id
    FROM public.episode_chunks
    WHERE model = _model
    GROUP BY episode_id
  )
  SELECT
    e.id,
    e.podcast_id,
    e.title,
    e.display_title,
    e.ai_summary,
    e.description,
    ct.cleaned_text,
    ct.source_hash,
    ct.cleaner_method,
    e.topics,
    e.people,
    e.companies,
    e.tickers,
    e.ingredients,
    p.title,
    p.display_title,
    p.language,
    p.shadow_rank_tier
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  JOIN public.episode_clean_text ct ON ct.episode_id = e.id
  WHERE p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND p.shadow_rank_tier IN ('S','A','B','C','D')
    AND ct.cleaner_method = 'deterministic_v4'
    AND length(trim(ct.cleaned_text)) >= 80
    AND NOT EXISTS (SELECT 1 FROM done d WHERE d.episode_id = e.id)
  ORDER BY
    CASE p.shadow_rank_tier WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,
    e.published_at DESC NULLS LAST
  LIMIT _limit;
$function$;

CREATE OR REPLACE FUNCTION public.embed_chunks_candidate_stats(_model text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH clean_eligible AS (
    SELECT e.id
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    JOIN public.episode_clean_text ct ON ct.episode_id = e.id
    WHERE p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND p.shadow_rank_tier IN ('S','A','B','C','D')
      AND ct.cleaner_method = 'deterministic_v4'
      AND length(trim(ct.cleaned_text)) >= 80
  ),
  waiting_for_clean AS (
    SELECT e.id
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND p.shadow_rank_tier IN ('S','A','B','C','D')
      AND COALESCE(e.description, '') <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.episode_clean_text ct
        WHERE ct.episode_id = e.id
          AND ct.cleaner_method = 'deterministic_v4'
          AND length(trim(ct.cleaned_text)) >= 80
      )
  ),
  done AS (
    SELECT episode_id
    FROM public.episode_chunks
    WHERE model = _model
    GROUP BY episode_id
  )
  SELECT jsonb_build_object(
    'eligible_total', (SELECT count(*) FROM clean_eligible),
    'waiting_for_clean_text', (SELECT count(*) FROM waiting_for_clean),
    'already_chunked', (SELECT count(*) FROM clean_eligible e WHERE EXISTS (SELECT 1 FROM done d WHERE d.episode_id = e.id)),
    'missing', (SELECT count(*) FROM clean_eligible e WHERE NOT EXISTS (SELECT 1 FROM done d WHERE d.episode_id = e.id)),
    'total_chunks', (SELECT count(*) FROM public.episode_chunks WHERE model = _model),
    'source_policy', 'best_source_then_deterministic_v4_clean_text_then_embedding'
  );
$function$;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'text_processing_policy',
  jsonb_build_object(
    'version', 'best_source_clean_text_first_v1',
    'order', jsonb_build_array('episode_best_text_source', 'episode_clean_text.deterministic_v4', 'seo_ai_summary_entities', 'episode_chunks_embeddings'),
    'embedding_requires_clean_text', true,
    'seo_episode_requires_clean_text_or_transcript', true,
    'note', 'RSS/YouTube/Spotify description is first selected into episode_best_text_source; all downstream AI and embeddings must use promoted deterministic_v4 clean text unless a transcript is present.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
