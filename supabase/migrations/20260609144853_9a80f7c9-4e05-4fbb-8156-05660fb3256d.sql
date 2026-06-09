CREATE OR REPLACE FUNCTION public.select_embed_episode_candidates(_model text, _limit integer)
RETURNS TABLE(
  id uuid, podcast_id uuid, title text, display_title text, description text,
  seo_description text, ai_summary text, topics text[], people text[], companies text[],
  tickers text[], ingredients text[], podcast_title text, podcast_display_title text, podcast_category text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT e.id, e.podcast_id, e.title, e.display_title,
    ct.cleaned_text AS description, e.seo_description, e.ai_summary,
    e.topics, e.people, e.companies, e.tickers, e.ingredients,
    p.title, p.display_title, p.category
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  JOIN public.episode_clean_text ct ON ct.episode_id = e.id
  WHERE p.language_decision = 'accept_hungarian'
    AND p.rank_label IN ('S','A','B','C')
    AND e.clean_text_status = 'done'
    AND ct.cleaner_method LIKE 'deterministic_v4%'
    AND length(trim(COALESCE(ct.cleaned_text, ''))) >= 80
    AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam')
    AND NOT EXISTS (SELECT 1 FROM public.episode_embeddings ee WHERE ee.episode_id = e.id AND ee.model = _model)
  ORDER BY CASE p.rank_label WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,
    p.podiverzum_rank DESC NULLS LAST, e.published_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(_limit, 200));
$function$;

GRANT EXECUTE ON FUNCTION public.select_embed_episode_candidates(text, integer) TO anon, authenticated, service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'text_processing_policy',
  jsonb_build_object(
    'version', 'best_source_clean_text_first_v4_final',
    'order', jsonb_build_array('episode_best_text_source','episode_clean_text.deterministic_v4_family','seo_ai_summary_entities','episode_chunks_embeddings'),
    'embedding_requires_clean_text', true,
    'seo_episode_requires_clean_text_or_transcript', true,
    'accepted_cleaner_method_prefix', 'deterministic_v4',
    'language_gate', 'podcasts.language_decision=accept_hungarian',
    'transcript_source_hash_passthrough', true,
    'timestamp_chunking_requires_transcript_hash_match', true,
    'clean_text_backfill_status', 'frozen_pending_quality_proof',
    'legacy_v3_backfill', 'manual_canary_only_until_quality_proof',
    'reasserted_by', '20260608191000_reassert_downstream_embedding_policy_v4_final'
  ), now()
)
ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'legacy_embed_episode_policy',
  jsonb_build_object(
    'enabled', true,
    'policy', 'deterministic_v4_family_clean_text_only',
    'accepted_cleaner_method_prefix', 'deterministic_v4',
    'language_gate', 'podcasts.language_decision=accept_hungarian',
    'reasserted_by', '20260608191000_reassert_downstream_embedding_policy_v4_final'
  ), now()
)
ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_chunk_search_result_policy',
  jsonb_build_object('version','timestamp_chunk_search_v3_content_snippet','content_snippet_required', true,'reasserted_by','20260608002000_reassert_chunk_search_content_snippet'),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at = now();