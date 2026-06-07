-- Treat deterministic_v4 variants (for example deterministic_v4+ytdesc) as
-- first-class promoted clean text for downstream embedding and AI gates.

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
  WHERE p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND p.shadow_rank_tier IN ('S','A','B','C','D')
    AND ct.cleaner_method LIKE 'deterministic_v4%'
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
      AND ct.cleaner_method LIKE 'deterministic_v4%'
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
          AND ct.cleaner_method LIKE 'deterministic_v4%'
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
    'source_policy', 'best_source_then_deterministic_v4_family_clean_text_then_embedding'
  );
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining int := GREATEST(1, LEAST(_limit, 200));
  v_tier text;
  v_rec record;
BEGIN
  FOREACH v_tier IN ARRAY ARRAY['S','A','B','C']::text[] LOOP
    EXIT WHEN v_remaining <= 0;
    FOR v_rec IN
      SELECT p.id AS pid, p.title AS p_title, p.display_title AS p_display_title, p.category AS p_category
        FROM public.podcasts p
       WHERE p.rank_label = v_tier
         AND p.is_hungarian = true
         AND p.language_decision = 'accept_hungarian'
         AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN
             ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam')
       ORDER BY p.podiverzum_rank DESC NULLS LAST
    LOOP
      EXIT WHEN v_remaining <= 0;
      FOR id, podcast_id, title, display_title, description, seo_description,
          ai_summary, topics, people, companies, tickers, ingredients,
          podcast_title, podcast_display_title, podcast_category IN
        SELECT e.id,
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
               v_rec.p_title,
               v_rec.p_display_title,
               v_rec.p_category
          FROM public.episodes e
          JOIN public.episode_clean_text ct ON ct.episode_id = e.id
         WHERE e.podcast_id = v_rec.pid
           AND e.clean_text_status = 'done'
           AND ct.cleaner_method LIKE 'deterministic_v4%'
           AND length(trim(COALESCE(ct.cleaned_text, ''))) >= 80
           AND NOT EXISTS (
             SELECT 1 FROM public.episode_embeddings ee
              WHERE ee.episode_id = e.id AND ee.model = _model
           )
         ORDER BY e.published_at DESC NULLS LAST
         LIMIT v_remaining
      LOOP
        RETURN NEXT;
        v_remaining := v_remaining - 1;
        EXIT WHEN v_remaining <= 0;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.embed_episode_candidate_stats(_model text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eligible bigint := 0;
  v_embedded bigint := 0;
BEGIN
  SELECT count(*) INTO v_eligible
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    JOIN public.episode_clean_text ct ON ct.episode_id = e.id
   WHERE p.rank_label IN ('S','A','B','C')
     AND p.is_hungarian = true
     AND p.language_decision = 'accept_hungarian'
     AND e.clean_text_status = 'done'
     AND ct.cleaner_method LIKE 'deterministic_v4%'
     AND length(trim(COALESCE(ct.cleaned_text, ''))) >= 80
     AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN
         ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam');

  SELECT count(*) INTO v_embedded
    FROM public.episode_embeddings
   WHERE model = _model;

  RETURN jsonb_build_object(
    'eligible_total', v_eligible,
    'already_embedded', v_embedded,
    'missing_embedding', GREATEST(v_eligible - v_embedded, 0),
    'source_policy', 'deterministic_v4_family_clean_text_only'
  );
END;
$function$;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'text_processing_policy',
  jsonb_build_object(
    'version', 'best_source_clean_text_first_v2',
    'order', jsonb_build_array('episode_best_text_source', 'episode_clean_text.deterministic_v4_family', 'seo_ai_summary_entities', 'episode_chunks_embeddings'),
    'embedding_requires_clean_text', true,
    'seo_episode_requires_clean_text_or_transcript', true,
    'accepted_cleaner_method_prefix', 'deterministic_v4',
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
    'note', 'Legacy single-episode embedding RPCs are gated to accepted Hungarian podcasts and promoted deterministic_v4-family clean text.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
