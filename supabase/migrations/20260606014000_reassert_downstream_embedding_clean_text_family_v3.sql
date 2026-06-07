-- Reassert downstream embedding candidate selection with accepted-Hungarian
-- decisions and promoted deterministic_v4-family clean text only.

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
  transcript_model text,
  transcript_segments jsonb,
  transcript_hash text,
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
    NULL::text AS transcript_model,
    NULL::jsonb AS transcript_segments,
    NULL::text AS transcript_hash,
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
  WHERE p.language_decision = 'accept_hungarian'
    AND p.shadow_rank_tier IN ('S','A','B','C','D')
    AND ct.cleaner_method LIKE 'deterministic_v4%'
    AND length(trim(ct.cleaned_text)) >= 80
    AND NOT EXISTS (SELECT 1 FROM done d WHERE d.episode_id = e.id)
  ORDER BY
    CASE p.shadow_rank_tier WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,
    e.published_at DESC NULLS LAST
  LIMIT _limit;
$function$;

CREATE OR REPLACE FUNCTION public.select_embed_episode_candidates(_model text, _limit integer)
RETURNS TABLE(
  id uuid,
  podcast_id uuid,
  title text,
  display_title text,
  description text,
  seo_description text,
  ai_summary text,
  topics text[],
  people text[],
  companies text[],
  tickers text[],
  ingredients text[],
  podcast_title text,
  podcast_display_title text,
  podcast_category text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    e.id,
    e.podcast_id,
    e.title,
    e.display_title,
    ct.cleaned_text AS description,
    e.seo_description,
    e.ai_summary,
    e.topics,
    e.people,
    e.companies,
    e.tickers,
    e.ingredients,
    p.title AS podcast_title,
    p.display_title AS podcast_display_title,
    p.category AS podcast_category
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  JOIN public.episode_clean_text ct ON ct.episode_id = e.id
  WHERE p.language_decision = 'accept_hungarian'
    AND p.rank_label IN ('S','A','B','C')
    AND e.clean_text_status = 'done'
    AND ct.cleaner_method LIKE 'deterministic_v4%'
    AND length(trim(COALESCE(ct.cleaned_text, ''))) >= 80
    AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN
        ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam')
    AND NOT EXISTS (
      SELECT 1
      FROM public.episode_embeddings ee
      WHERE ee.episode_id = e.id
        AND ee.model = _model
    )
  ORDER BY
    CASE p.rank_label WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,
    p.podiverzum_rank DESC NULLS LAST,
    e.published_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(_limit, 200));
$function$;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'text_processing_policy',
  jsonb_build_object(
    'version', 'best_source_clean_text_first_v3',
    'order', jsonb_build_array('episode_best_text_source', 'episode_clean_text.deterministic_v4_family', 'seo_ai_summary_entities', 'episode_chunks_embeddings'),
    'embedding_requires_clean_text', true,
    'seo_episode_requires_clean_text_or_transcript', true,
    'accepted_cleaner_method_prefix', 'deterministic_v4',
    'language_gate', 'podcasts.language_decision=accept_hungarian',
    'reasserted_by', '20260606014000_reassert_downstream_embedding_clean_text_family_v3',
    'note', 'Downstream AI and embeddings must use transcript or promoted deterministic_v4-family clean text, including deterministic_v4+ytdesc.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

INSERT INTO public.app_settings(key, value, updated_at)
VALUES (
  'legacy_embed_episode_policy',
  jsonb_build_object(
    'enabled', true,
    'policy', 'deterministic_v4_family_clean_text_only',
    'accepted_cleaner_method_prefix', 'deterministic_v4',
    'language_gate', 'podcasts.language_decision=accept_hungarian',
    'reasserted_by', '20260606014000_reassert_downstream_embedding_clean_text_family_v3',
    'note', 'Legacy single-episode embedding RPCs are gated to accepted Hungarian podcasts and promoted deterministic_v4-family clean text.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

DO $$
DECLARE
  v_episode_def text;
  v_chunks_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_episode_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'select_embed_episode_candidates'
    AND oidvectortypes(p.proargtypes) = 'text, integer'
  LIMIT 1;

  SELECT pg_get_functiondef(p.oid)
  INTO v_chunks_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'select_embed_chunks_candidates'
    AND oidvectortypes(p.proargtypes) = 'text, integer'
  LIMIT 1;

  IF v_episode_def IS NULL OR v_episode_def NOT ILIKE '%ct.cleaner_method LIKE ''deterministic_v4%%''%' THEN
    RAISE EXCEPTION 'select_embed_episode_candidates does not require deterministic_v4-family clean text';
  END IF;

  IF v_chunks_def IS NULL OR v_chunks_def NOT ILIKE '%ct.cleaner_method LIKE ''deterministic_v4%%''%' THEN
    RAISE EXCEPTION 'select_embed_chunks_candidates does not require deterministic_v4-family clean text';
  END IF;

  IF v_episode_def ILIKE ('%' || 'p.is_hungarian' || ' = true%')
     OR v_chunks_def ILIKE ('%' || 'p.is_hungarian' || ' = true%') THEN
    RAISE EXCEPTION 'embedding candidate RPCs must use language_decision without legacy is_hungarian positive gates';
  END IF;
END $$;
