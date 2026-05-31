-- Controlled v3 -> v4 clean-text backfill.
-- The old deterministic_v3 rows often sit behind episodes.clean_text_status='done',
-- so pending-only runners never revisit them. This RPC reopens a bounded,
-- tier-prioritized slice without deleting the existing clean text row.

CREATE OR REPLACE FUNCTION public.requeue_legacy_clean_text_v4_backfill(
  _limit integer DEFAULT 1000,
  _tiers text[] DEFAULT ARRAY['S','A','B','C','D']
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(_limit, 1000), 5000));
  v_result jsonb;
BEGIN
  WITH chosen AS (
    SELECT
      e.id,
      COALESCE(p.shadow_rank_tier, p.rank_label, 'D') AS tier,
      CASE COALESCE(p.shadow_rank_tier, p.rank_label, 'D')
        WHEN 'S' THEN 0
        WHEN 'A' THEN 1
        WHEN 'B' THEN 2
        WHEN 'C' THEN 3
        WHEN 'D' THEN 4
        ELSE 5
      END AS tier_order,
      e.published_at
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    JOIN public.episode_clean_text ct ON ct.episode_id = e.id
    WHERE p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND COALESCE(e.description, e.summary, '') <> ''
      AND COALESCE(e.clean_text_status, 'pending') = 'done'
      AND COALESCE(ct.cleaner_method, '') NOT LIKE 'deterministic_v4%'
      AND COALESCE(p.shadow_rank_tier, p.rank_label, 'D') = ANY(_tiers)
    ORDER BY
      tier_order,
      e.published_at DESC NULLS LAST,
      e.updated_at DESC NULLS LAST
    LIMIT v_limit
  ),
  updated AS (
    UPDATE public.episodes e
    SET clean_text_status = 'pending'
    FROM chosen c
    WHERE e.id = c.id
    RETURNING e.id, c.tier
  ),
  by_tier AS (
    SELECT tier, count(*) AS n
    FROM updated
    GROUP BY tier
  )
  SELECT jsonb_build_object(
    'ok', true,
    'policy', 'legacy_v3_to_pending_for_deterministic_v4_backfill',
    'requested_limit', v_limit,
    'tiers', to_jsonb(_tiers),
    'requeued', COALESCE((SELECT count(*) FROM updated), 0),
    'by_tier', COALESCE((SELECT jsonb_object_agg(tier, n) FROM by_tier), '{}'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.requeue_legacy_clean_text_v4_backfill(integer, text[]) TO service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_clean_text_controls',
  jsonb_build_object(
    'enabled', true,
    'batch_limit', 1000,
    'method_version', 'deterministic_v4',
    'time_budget_seconds', 75,
    'min_description_chars', 40,
    'use_best_text_source', true,
    'legacy_v3_backfill_enabled', true,
    'legacy_v3_backfill_limit', 2000,
    'legacy_v3_backfill_tiers', jsonb_build_array('S','A','B','C','D'),
    'note', 'Deterministic v4 drain: reopen legacy v3 done rows in bounded tier-prioritized batches, use episode_best_text_source first, no AI spend.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'enabled', true,
    'batch_limit', 1000,
    'method_version', 'deterministic_v4',
    'time_budget_seconds', 75,
    'min_description_chars', COALESCE(public.app_settings.value->'min_description_chars', '40'::jsonb),
    'use_best_text_source', true,
    'legacy_v3_backfill_enabled', true,
    'legacy_v3_backfill_limit', 2000,
    'legacy_v3_backfill_tiers', jsonb_build_array('S','A','B','C','D'),
    'note', 'Deterministic v4 drain: reopen legacy v3 done rows in bounded tier-prioritized batches, use episode_best_text_source first, no AI spend.'
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'text_processing_policy',
  jsonb_build_object(
    'version', 'best_source_clean_text_first_v3',
    'order', jsonb_build_array('episode_best_text_source', 'episode_clean_text.deterministic_v4_family', 'seo_ai_summary_entities', 'episode_chunks_embeddings'),
    'embedding_requires_clean_text', true,
    'seo_episode_requires_clean_text_or_transcript', true,
    'accepted_cleaner_method_prefix', 'deterministic_v4',
    'legacy_v3_backfill', 'bounded_pending_requeue',
    'note', 'Legacy deterministic_v3 rows are reopened in bounded batches and rewritten from episode_best_text_source before downstream processing.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'version', 'best_source_clean_text_first_v3',
    'accepted_cleaner_method_prefix', 'deterministic_v4',
    'legacy_v3_backfill', 'bounded_pending_requeue',
    'note', 'Legacy deterministic_v3 rows are reopened in bounded batches and rewritten from episode_best_text_source before downstream processing.'
  ),
  updated_at = now();
