-- Support the queue counters so they finish inside the statement timeout.
create index if not exists idx_episodes_clean_text_status_pending
  on public.episodes (podcast_id)
  where clean_text_status is null or clean_text_status = 'pending';

create index if not exists idx_episode_ai_class_episode_status
  on public.episode_ai_classifications (episode_id)
  where classification_status = 'classified';

create or replace function public.count_pipeline_pending(kind text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
DECLARE
  n bigint := 0;
BEGIN
  IF kind = 'embed_podcast_pending' THEN
    SELECT count(*) INTO n
    FROM podcasts p
    WHERE p.rank_label IN ('S','A','B','C')
      AND p.language_decision = 'accept_hungarian'
      AND NOT EXISTS (
        SELECT 1 FROM podcast_embeddings pe
        WHERE pe.podcast_id = p.id AND pe.model = 'google/gemini-embedding-001'
      );
  ELSIF kind = 'seo_jobs_pending' THEN
    SELECT count(*) INTO n FROM ai_enrichment_jobs WHERE status = 'pending';
  ELSIF kind = 'ai_categorize_pending' THEN
    SELECT count(*) INTO n
    FROM podcasts
    WHERE category IS NULL
      AND shadow_rank_tier IN ('S','A','B','C')
      AND language_decision = 'accept_hungarian';
  ELSIF kind = 'episode_classifier_pending' THEN
    SELECT count(*) INTO n FROM (
      SELECT 1
      FROM episodes e
      JOIN podcasts p ON p.id = e.podcast_id
      WHERE p.language_decision = 'accept_hungarian'
        AND p.rank_label IN ('S','A','B','C')
        AND NOT EXISTS (
          SELECT 1 FROM episode_ai_classifications c
          WHERE c.episode_id = e.id AND c.classification_status = 'classified'
        )
      LIMIT 5000
    ) t;
  ELSIF kind = 'entity_backfill_pending' THEN
    SELECT count(*) INTO n FROM (
      SELECT 1
      FROM episodes e
      JOIN podcasts p ON p.id = e.podcast_id
      WHERE (e.ai_entities_version IS NULL OR e.ai_entities_version < 5)
        AND e.clean_text_status = 'done'
        AND p.language_decision = 'accept_hungarian'
      LIMIT 20001
    ) t;
  ELSIF kind = 'person_ai_review_pending' THEN
    SELECT count(*) INTO n
    FROM people
    WHERE ai_review_status = 'pending'
      AND is_public = true
      AND coalesce(gated_episode_count, 0) >= 1;
  ELSIF kind = 'clean_text_pending' THEN
    SELECT count(*) INTO n FROM (
      SELECT 1
      FROM episodes e
      WHERE (e.clean_text_status IS NULL OR e.clean_text_status = 'pending')
      LIMIT 5000
    ) t;
  ELSIF kind = 'ai_jobs_pending' THEN
    SELECT count(*) INTO n FROM ai_enrichment_jobs WHERE status = 'pending';
  END IF;
  RETURN COALESCE(n, 0);
END;
$$;

grant execute on function public.count_pipeline_pending(text) to service_role;