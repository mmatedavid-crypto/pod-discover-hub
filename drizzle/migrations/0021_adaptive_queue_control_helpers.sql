-- Adaptive scheduling helper: lets the queue-health-controller retune a cron job's
-- cadence from the edge runtime (cron schema is not reachable over the Data API).
create or replace function public.set_runner_cron(p_job_name text, p_schedule text)
returns text
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  v_current text;
begin
  if p_schedule !~ '^[0-9*/,\- ]+$' then
    raise exception 'invalid schedule';
  end if;
  select schedule into v_current from cron.job where jobname = p_job_name;
  if v_current is null then
    return 'job_not_found';
  end if;
  if v_current = p_schedule then
    return 'unchanged';
  end if;
  perform cron.alter_job((select jobid from cron.job where jobname = p_job_name), schedule := p_schedule);
  return 'changed:' || v_current || '->' || p_schedule;
end;
$$;

revoke all on function public.set_runner_cron(text, text) from public, anon, authenticated;
grant execute on function public.set_runner_cron(text, text) to service_role;

-- More pending counters so every runner can be queue-governed.
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
    SELECT count(*) INTO n
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE p.language_decision = 'accept_hungarian'
      AND p.rank_label IN ('S','A','B','C')
      AND NOT EXISTS (
        SELECT 1 FROM episode_ai_classifications c
        WHERE c.episode_id = e.id AND c.classification_status = 'classified'
      );
  ELSIF kind = 'entity_backfill_pending' THEN
    SELECT count(*) INTO n
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE (e.ai_entities_version IS NULL OR e.ai_entities_version < 5)
      AND e.clean_text_status = 'done'
      AND p.language_decision = 'accept_hungarian';
  ELSIF kind = 'person_ai_review_pending' THEN
    SELECT count(*) INTO n
    FROM people
    WHERE ai_review_status = 'pending'
      AND is_public = true
      AND coalesce(gated_episode_count, 0) >= 1;
  ELSIF kind = 'clean_text_pending' THEN
    SELECT count(*) INTO n
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE p.language_decision = 'accept_hungarian'
      AND (e.clean_text_status IS NULL OR e.clean_text_status = 'pending');
  ELSIF kind = 'ai_jobs_pending' THEN
    SELECT count(*) INTO n FROM ai_enrichment_jobs WHERE status = 'pending';
  END IF;
  RETURN COALESCE(n, 0);
END;
$$;

grant execute on function public.count_pipeline_pending(text) to service_role;