-- ====== 20260605001000 search quality weekly automation ======
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'search_golden_refresh_controls',
  jsonb_build_object('enabled', true, 'catalog_limit_per_type', 80, 'popular_limit', 40,
    'external_chart_limit', 120, 'external_seed_limit', 100, 'cadence', 'weekly',
    'note', 'Weekly refresh: titles+people+orgs+topics+demand+charts.'),
  now()) ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'search_benchmark_controls',
  jsonb_build_object('enabled', true, 'cadence', 'weekly_drain', 'batch_size', 35,
    'max_queries_per_week', 220, 'per_call_timeout_ms', 45000, 'max_attempts', 2,
    'refresh_before_new_run', true, 'catalog_limit_per_type', 80, 'popular_limit', 40,
    'external_chart_limit', 120, 'external_seed_limit', 100, 'min_days_between_runs', 6,
    'quality_policy', 'weekly_search_benchmark_v1'),
  now()) ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at) VALUES
  ('search_golden_refresh_progress', jsonb_build_object('ok', null, 'status', 'not_run_yet'), now()),
  ('search_benchmark_progress', jsonb_build_object('ok', null, 'status', 'not_run_yet'), now())
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-search-golden-refresh-weekly') THEN
    PERFORM cron.unschedule('podiverzum-search-golden-refresh-weekly');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-search-benchmark-runner-30min') THEN
    PERFORM cron.unschedule('podiverzum-search-benchmark-runner-30min');
  END IF;
  PERFORM cron.schedule('podiverzum-search-golden-refresh-weekly', '5 1 * * 1', $cmd$
    SELECT net.http_post(url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/search-golden-refresh',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
      body := concat('{"trigger":"weekly_cron","ts":"', now(), '"}')::jsonb);
  $cmd$);
  PERFORM cron.schedule('podiverzum-search-benchmark-runner-30min', '*/30 * * * *', $cmd$
    SELECT net.http_post(url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/search-benchmark-runner',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
      body := concat('{"trigger":"benchmark_drain_cron","ts":"', now(), '"}')::jsonb);
  $cmd$);
END $$;

-- ====== 20260605003000 recommendation v5 entity bridge ======
CREATE OR REPLACE FUNCTION public.recommendation_has_content_bridge(
  p_source_topics text[], p_candidate_topics text[],
  p_source_people text[], p_candidate_people text[],
  p_source_companies text[], p_candidate_companies text[]
) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM unnest(coalesce(p_source_topics, ARRAY[]::text[])) s(value)
                 JOIN unnest(coalesce(p_candidate_topics, ARRAY[]::text[])) c(value) ON lower(s.value)=lower(c.value))
  OR EXISTS (SELECT 1 FROM unnest(coalesce(p_source_people, ARRAY[]::text[])) s(value)
             JOIN unnest(coalesce(p_candidate_people, ARRAY[]::text[])) c(value) ON lower(s.value)=lower(c.value))
  OR EXISTS (SELECT 1 FROM unnest(coalesce(p_source_companies, ARRAY[]::text[])) s(value)
             JOIN unnest(coalesce(p_candidate_companies, ARRAY[]::text[])) c(value) ON lower(s.value)=lower(c.value));
$function$;

CREATE OR REPLACE FUNCTION public.recommendation_is_compatible(
  p_source_group text, p_candidate_group text, p_similarity double precision, p_has_topic_bridge boolean
) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $function$
  SELECT CASE
    WHEN (p_source_group='religion') <> (p_candidate_group='religion') THEN false
    WHEN p_candidate_group='children' AND p_source_group<>'children' THEN false
    WHEN p_source_group='children' AND p_candidate_group<>'children' AND NOT p_has_topic_bridge THEN false
    WHEN p_source_group<>'general' AND p_candidate_group<>'general' AND p_source_group<>p_candidate_group THEN p_has_topic_bridge
    WHEN p_source_group<>'general' AND p_candidate_group='general' THEN p_has_topic_bridge
    WHEN p_candidate_group<>'general' AND p_source_group='general' THEN p_has_topic_bridge
    WHEN p_source_group<>'general' AND p_source_group=p_candidate_group THEN p_has_topic_bridge OR coalesce(p_similarity,0)>=0.70
    ELSE p_has_topic_bridge OR coalesce(p_similarity,0)>=0.82
  END;
$function$;

DROP FUNCTION IF EXISTS public.get_related_episodes_by_embedding(uuid, integer, boolean);
CREATE OR REPLACE FUNCTION public.get_related_episodes_by_embedding(
  p_episode_id uuid, p_limit integer DEFAULT 8, p_downweight_same_podcast boolean DEFAULT true
) RETURNS TABLE(episode_id uuid, podcast_id uuid, similarity double precision, final_score double precision,
  title text, display_title text, slug text, ai_summary text, summary text, description text,
  published_at timestamp with time zone, audio_url text, image_url text, topics text[],
  podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text,
  podcast_category text, podiverzum_rank numeric, rank_label text, related_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE src_embedding vector(768); src_podcast_id uuid; src_topics text[]; src_people text[]; src_companies text[]; src_group text;
BEGIN
  SELECT ee.embedding, ee.podcast_id INTO src_embedding, src_podcast_id FROM episode_embeddings ee WHERE ee.episode_id=p_episode_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;
  SELECT COALESCE(e.topics,'{}'), COALESCE(e.people,'{}')||COALESCE(e.mentioned,'{}'), COALESCE(e.companies,'{}'),
         public.recommendation_text_group(e.title, pod.title, pod.category, e.topics)
  INTO src_topics, src_people, src_companies, src_group
  FROM episodes e JOIN podcasts pod ON pod.id=e.podcast_id WHERE e.id=p_episode_id;

  RETURN QUERY
  WITH ep_cand AS (SELECT ee.episode_id AS eid, ee.podcast_id AS pid, (1-(ee.embedding<=>src_embedding))::float AS sim
    FROM episode_embeddings ee WHERE ee.episode_id<>p_episode_id ORDER BY ee.embedding<=>src_embedding LIMIT 260),
  chunk_cand AS (SELECT DISTINCT ON (ec.episode_id) ec.episode_id AS eid, ec.podcast_id AS pid, (1-(ec.embedding<=>src_embedding))::float AS sim
    FROM episode_chunks ec WHERE ec.episode_id<>p_episode_id ORDER BY ec.episode_id, ec.embedding<=>src_embedding LIMIT 260),
  pool AS (SELECT eid, pid, max(sim) AS sim FROM (SELECT * FROM ep_cand UNION ALL SELECT * FROM chunk_cand) u GROUP BY eid, pid),
  cand AS (
    SELECT e.id AS eid, e.podcast_id AS pid, p.sim,
      e.title, e.display_title, e.slug, e.ai_summary, e.summary, e.description,
      e.published_at, e.audio_url, e.image_url, COALESCE(e.topics, ARRAY[]::text[]) AS topics,
      COALESCE(e.people, ARRAY[]::text[])||COALESCE(e.mentioned, ARRAY[]::text[]) AS people_all,
      COALESCE(e.companies, ARRAY[]::text[]) AS companies,
      pod.slug AS p_slug, pod.title AS p_title, pod.display_title AS p_display_title,
      pod.image_url AS p_image, pod.category AS p_category, pod.podiverzum_rank AS p_rank, pod.rank_label AS p_rank_label,
      (e.podcast_id=src_podcast_id) AS same_pod,
      public.recommendation_has_content_bridge(src_topics, e.topics, src_people, COALESCE(e.people, ARRAY[]::text[])||COALESCE(e.mentioned, ARRAY[]::text[]), src_companies, e.companies) AS content_bridge,
      public.recommendation_text_group(e.title, pod.title, pod.category, e.topics) AS candidate_group
    FROM pool p JOIN episodes e ON e.id=p.eid JOIN podcasts pod ON pod.id=e.podcast_id
    WHERE pod.is_hungarian=true AND pod.language_decision='accept_hungarian'
      AND COALESCE(pod.rss_status,'healthy') NOT IN ('failed','inactive') AND e.audio_url IS NOT NULL),
  scored AS (
    SELECT c.*,
      COALESCE(array_length(ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(c.topics)),1),0) AS topic_overlap,
      COALESCE(array_length(ARRAY(SELECT unnest(src_people) INTERSECT SELECT unnest(c.people_all)),1),0) AS people_overlap,
      COALESCE(array_length(ARRAY(SELECT unnest(src_companies) INTERSECT SELECT unnest(c.companies)),1),0) AS company_overlap,
      (c.sim*1.0
       + CASE c.p_rank_label WHEN 'S' THEN 0.05 WHEN 'A' THEN 0.03 WHEN 'B' THEN 0.015 ELSE 0 END
       + CASE WHEN c.published_at IS NOT NULL AND c.published_at > now() - interval '180 days' THEN 0.03 ELSE 0 END
       + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(c.topics)),1),0)*0.05, 0.15)
       + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_people) INTERSECT SELECT unnest(c.people_all)),1),0)*0.08, 0.20)
       + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_companies) INTERSECT SELECT unnest(c.companies)),1),0)*0.07, 0.18)
       - CASE WHEN COALESCE(length(coalesce(c.ai_summary,c.summary,c.description)),0)<80 THEN 0.05 ELSE 0 END
      )::float AS fscore
    FROM cand c WHERE (p_downweight_same_podcast=false OR c.same_pod=false)
      AND public.recommendation_is_compatible(src_group, c.candidate_group, c.sim, c.content_bridge)),
  diversified AS (SELECT s.*, row_number() OVER (PARTITION BY s.pid ORDER BY s.fscore DESC) AS rn_per_pod FROM scored s)
  SELECT d.eid, d.pid, d.sim, d.fscore, d.title, d.display_title, d.slug, d.ai_summary, d.summary, d.description,
    d.published_at, d.audio_url, d.image_url, d.topics,
    d.p_slug, d.p_title, d.p_display_title, d.p_image, d.p_category, d.p_rank, d.p_rank_label,
    CASE WHEN d.people_overlap>0 THEN 'Kapcsolódó személyek alapján.'
         WHEN d.company_overlap>0 THEN 'Kapcsolódó szervezet vagy márka alapján.'
         WHEN d.topic_overlap>0 THEN 'Hasonló témák: ' || array_to_string((ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(d.topics)))[1:3], ', ')
         WHEN d.sim>=0.82 THEN 'Erős tartalmi közelség az epizód-index alapján.'
         ELSE 'Tartalmilag rokon epizód.' END AS related_reason
  FROM diversified d WHERE d.rn_per_pod=1 AND d.sim>=0.50
  ORDER BY d.fscore DESC LIMIT GREATEST(p_limit,1);
END;
$function$;

DROP FUNCTION IF EXISTS public.similar_episodes(uuid, integer);
CREATE OR REPLACE FUNCTION public.similar_episodes(p_episode_id uuid, p_limit integer DEFAULT 6)
RETURNS TABLE(episode_id uuid, podcast_id uuid, similarity double precision,
  title text, display_title text, slug text, ai_summary text, summary text, description text,
  published_at timestamp with time zone, audio_url text, topics text[],
  podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text,
  podcast_category text, podiverzum_rank numeric, rank_label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE src_embedding vector(768); src_podcast_id uuid; src_topics text[]; src_people text[]; src_companies text[]; src_group text;
BEGIN
  SELECT ee.embedding, ee.podcast_id INTO src_embedding, src_podcast_id FROM episode_embeddings ee WHERE ee.episode_id=p_episode_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;
  SELECT COALESCE(e.topics,'{}'), COALESCE(e.people,'{}')||COALESCE(e.mentioned,'{}'), COALESCE(e.companies,'{}'),
         public.recommendation_text_group(e.title, pod.title, pod.category, e.topics)
  INTO src_topics, src_people, src_companies, src_group
  FROM episodes e JOIN podcasts pod ON pod.id=e.podcast_id WHERE e.id=p_episode_id;

  RETURN QUERY
  WITH ep_cand AS (SELECT ee.episode_id AS eid, ee.podcast_id AS pid, (1-(ee.embedding<=>src_embedding))::float AS sim
    FROM episode_embeddings ee WHERE ee.episode_id<>p_episode_id
      AND ee.podcast_id<>COALESCE(src_podcast_id,'00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY ee.embedding<=>src_embedding LIMIT 260),
  chunk_cand AS (SELECT DISTINCT ON (ec.episode_id) ec.episode_id AS eid, ec.podcast_id AS pid, (1-(ec.embedding<=>src_embedding))::float AS sim
    FROM episode_chunks ec WHERE ec.episode_id<>p_episode_id
      AND ec.podcast_id<>COALESCE(src_podcast_id,'00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY ec.episode_id, ec.embedding<=>src_embedding LIMIT 260),
  pool AS (SELECT eid, pid, max(sim) AS sim FROM (SELECT * FROM ep_cand UNION ALL SELECT * FROM chunk_cand) u GROUP BY eid, pid),
  scored AS (
    SELECT e.id AS eid, e.podcast_id AS pid, p.sim,
      e.title, e.display_title, e.slug, e.ai_summary, e.summary, e.description,
      e.published_at, e.audio_url, COALESCE(e.topics, ARRAY[]::text[]) AS topics,
      pod.slug AS p_slug, pod.title AS p_title, pod.display_title AS p_display_title,
      pod.image_url AS p_image, pod.category AS p_category, pod.podiverzum_rank AS p_rank, pod.rank_label AS p_rank_label,
      (p.sim
       + CASE pod.rank_label WHEN 'S' THEN 0.05 WHEN 'A' THEN 0.03 WHEN 'B' THEN 0.015 ELSE 0 END
       + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(e.topics)),1),0)*0.05, 0.15)
       + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_people) INTERSECT SELECT unnest(COALESCE(e.people, ARRAY[]::text[])||COALESCE(e.mentioned, ARRAY[]::text[]))),1),0)*0.08, 0.20)
       + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_companies) INTERSECT SELECT unnest(e.companies)),1),0)*0.07, 0.18)
      )::float AS fscore
    FROM pool p JOIN episodes e ON e.id=p.eid JOIN podcasts pod ON pod.id=e.podcast_id
    WHERE pod.is_hungarian=true AND pod.language_decision='accept_hungarian'
      AND COALESCE(pod.rss_status,'healthy') NOT IN ('failed','inactive') AND e.audio_url IS NOT NULL
      AND public.recommendation_is_compatible(src_group,
        public.recommendation_text_group(e.title, pod.title, pod.category, e.topics), p.sim,
        public.recommendation_has_content_bridge(src_topics, e.topics, src_people,
          COALESCE(e.people, ARRAY[]::text[])||COALESCE(e.mentioned, ARRAY[]::text[]), src_companies, e.companies))),
  diversified AS (SELECT s.*, row_number() OVER (PARTITION BY s.pid ORDER BY s.fscore DESC) AS rn_per_pod FROM scored s)
  SELECT d.eid, d.pid, d.sim, d.title, d.display_title, d.slug, d.ai_summary, d.summary, d.description,
    d.published_at, d.audio_url, d.topics,
    d.p_slug, d.p_title, d.p_display_title, d.p_image, d.p_category, d.p_rank, d.p_rank_label
  FROM diversified d WHERE d.rn_per_pod=1 AND d.sim>=0.50
  ORDER BY d.fscore DESC LIMIT GREATEST(p_limit,1);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.recommendation_has_content_bridge(text[],text[],text[],text[],text[],text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recommendation_is_compatible(text,text,double precision,boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_related_episodes_by_embedding(uuid,integer,boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.similar_episodes(uuid,integer) TO anon, authenticated, service_role;

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'related_episode_quality_policy',
  jsonb_build_object('version',5,'religion_cross_group','hard_block','children_cross_group','hard_block_except_children_source_with_explicit_bridge',
    'different_specific_groups','explicit_bridge_required','specific_to_general','explicit_bridge_required','general_to_specific','explicit_bridge_required',
    'same_specific_group_min_similarity_without_bridge',0.70,'general_min_similarity_without_bridge',0.82,
    'bridge_sources',jsonb_build_array('topics','people','mentioned','companies')),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- ====== 20260605004500 strict dead-person no podcast profile guard v3 ======
UPDATE public.people p
SET is_public=false, is_indexable=false, is_browsable_in_people_hub=false,
    activation_status='inactive', ai_recommended_action='hide',
    browsable_reason='strict_dead_person_no_podcast_profile_guard_v3',
    editorial_notes=trim(both E'\n' from concat_ws(E'\n', nullif(p.editorial_notes,''), 'strict_dead_person_no_podcast_profile_guard_v3')),
    updated_at=now()
WHERE COALESCE(p.manual_approved,false)=false AND COALESCE(p.has_archival_evidence,false)=false
  AND (p.is_deceased IS TRUE OR p.is_historical IS TRUE OR p.persona='historical'
       OR p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
  AND (p.is_public IS TRUE OR p.is_indexable IS TRUE OR p.is_browsable_in_people_hub IS TRUE
       OR p.activation_status<>'inactive' OR COALESCE(p.ai_recommended_action,'')<>'hide');

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'temporal_person_public_guard_policy',
  jsonb_build_object('version',3,'rule','Deceased/historical/date_of_death/is_living=false → not public/indexable unless manual_approved or has_archival_evidence.',
    'name_collision_policy','Fail closed.'),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

DROP FUNCTION IF EXISTS public.list_people_hub(integer, integer, text);
CREATE OR REPLACE FUNCTION public.list_people_hub(p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, slug text, name text, disambiguation_label text, short_bio text, ai_bio text, image_url text,
  identity_ambiguous boolean, manual_approved boolean, ai_bio_status text, ai_bio_confidence numeric,
  wikipedia_match_status text, wikipedia_match_confidence numeric,
  episode_count integer, podcast_count integer, distinct_podcast_count integer,
  gated_episode_count integer, gated_podcast_count integer, host_count integer, guest_count integer,
  strong_mention_count integer, recent_relevant_episode_count_30d integer,
  latest_accepted_relevant_episode_at timestamp with time zone, people_hub_score numeric, total_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH base AS (
    SELECT * FROM public.people p
    WHERE p.is_browsable_in_people_hub=true
      AND NOT (COALESCE(p.manual_approved,false)=false AND COALESCE(p.has_archival_evidence,false)=false
        AND (p.is_deceased IS TRUE OR p.is_historical IS TRUE OR p.persona='historical'
             OR p.date_of_death IS NOT NULL OR p.is_living IS FALSE))
      AND (p_search IS NULL OR length(trim(p_search))<2
           OR p.normalized_name ILIKE '%'||lower(trim(p_search))||'%' OR p.name ILIKE '%'||trim(p_search)||'%')
  ), counted AS (SELECT COUNT(*)::bigint AS tc FROM base)
  SELECT b.id,b.slug,b.name,b.disambiguation_label,b.short_bio,b.ai_bio,b.image_url,
    b.identity_ambiguous,b.manual_approved,b.ai_bio_status,b.ai_bio_confidence,
    b.wikipedia_match_status,b.wikipedia_match_confidence,
    b.episode_count,b.podcast_count,b.distinct_podcast_count,
    b.gated_episode_count,b.gated_podcast_count,b.host_count,b.guest_count,
    b.strong_mention_count,b.recent_relevant_episode_count_30d,
    b.latest_accepted_relevant_episode_at,b.people_hub_score,c.tc
  FROM base b CROSS JOIN counted c
  ORDER BY b.people_hub_score DESC NULLS LAST, b.gated_episode_count DESC, b.name ASC
  LIMIT GREATEST(LEAST(p_limit,200),1) OFFSET GREATEST(p_offset,0);
$function$;

DROP FUNCTION IF EXISTS public.list_people_alpha(text, integer, integer);
CREATE OR REPLACE FUNCTION public.list_people_alpha(p_letter text DEFAULT NULL::text, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, slug text, name text, disambiguation_label text, short_bio text, ai_bio text, image_url text,
  identity_ambiguous boolean, manual_approved boolean, ai_bio_status text, ai_bio_confidence numeric,
  wikipedia_match_status text, wikipedia_match_confidence numeric,
  gated_episode_count integer, gated_podcast_count integer, episode_count integer, podcast_count integer,
  latest_accepted_relevant_episode_at timestamp with time zone, host_count integer, guest_count integer,
  strong_mention_count integer, total_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH filtered AS (
    SELECT * FROM public.people p
    WHERE p.is_public=true AND p.is_browsable_in_people_hub=true AND COALESCE(p.gated_episode_count,0)>=1
      AND NOT (COALESCE(p.manual_approved,false)=false AND COALESCE(p.has_archival_evidence,false)=false
        AND (p.is_deceased IS TRUE OR p.is_historical IS TRUE OR p.persona='historical'
             OR p.date_of_death IS NOT NULL OR p.is_living IS FALSE))
      AND (p_letter IS NULL OR (p_letter='#' AND NOT (upper(unaccent(left(p.name,1))) ~ '^[A-Z]$'))
           OR upper(unaccent(left(p.name,1)))=upper(p_letter))
  ), counted AS (SELECT count(*)::bigint AS total FROM filtered)
  SELECT f.id,f.slug,f.name,f.disambiguation_label,f.short_bio,f.ai_bio,f.image_url,
    f.identity_ambiguous,f.manual_approved,f.ai_bio_status,f.ai_bio_confidence,
    f.wikipedia_match_status,f.wikipedia_match_confidence,
    f.gated_episode_count,f.gated_podcast_count,f.episode_count,f.podcast_count,
    f.latest_accepted_relevant_episode_at,f.host_count,f.guest_count,f.strong_mention_count,c.total
  FROM filtered f, counted c ORDER BY unaccent(f.name) ASC, f.name ASC LIMIT p_limit OFFSET p_offset;
$function$;

GRANT EXECUTE ON FUNCTION public.list_people_hub(integer,integer,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_people_alpha(text,integer,integer) TO anon, authenticated;

-- ====== 20260605010000 public AI language guard v4 EN-phrase ======
CREATE OR REPLACE FUNCTION public.is_hungarianish_public_ai_text(_text text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE raw text := coalesce(_text,''); t text := lower(coalesce(_text,''));
  words text[]; total int; hu_hits int := 0; en_hits int := 0; phrase_hits int := 0; dia_hits int := 0; w text;
  hu_ratio numeric; en_ratio numeric; dia_per100 numeric; has_hu_signal boolean;
BEGIN
  IF _text IS NULL OR length(trim(_text)) < 20 THEN RETURN true; END IF;
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

  words := regexp_split_to_array(trim(regexp_replace(t,'[^[:alpha:]'']+',' ','g')),'\s+');
  total := greatest(coalesce(array_length(words,1),0),1);
  FOREACH w IN ARRAY words LOOP
    IF w = ANY (ARRAY['és','hogy','a','az','egy','van','nem','mert','podcast','adás','adas','epizód','epizod','beszélgetés','beszelgetes','magyar','témája','temaja','vendég','vendeg','műsor','musor','hallgatók','hallgatok','szól','szol','bemutatja','körül','korul','kapcsolatban','szerint','alapján','alapjan','közben','kozben','arról','arrol','erről','errol','hazai','közéleti','kozeleti','gazdasági','gazdasagi','társadalmi','tarsadalmi']) THEN
      hu_hits := hu_hits+1;
    ELSIF w = ANY (ARRAY['the','and','of','to','in','is','for','on','with','that','this','are','was','were','by','from','as','at','an','be','or','it','its','their','they','you','we','our','your','has','have','had','but','not','which','also','more','than','these','those','about','when','what','who','how','why','episode','discusses','explores','features','conversation','interview','host','guest','listeners','summary']) THEN
      en_hits := en_hits+1;
    END IF;
  END LOOP;
  dia_hits := length(t) - length(regexp_replace(t,'[áéíóöőúüű]','','g'));
  hu_ratio := hu_hits::numeric/total::numeric;
  en_ratio := en_hits::numeric/total::numeric;
  dia_per100 := dia_hits::numeric/greatest(length(t),1)::numeric*100;
  has_hu_signal := hu_ratio >= 0.02 OR dia_per100 >= 1.2;
  IF phrase_hits >= 2 AND NOT has_hu_signal THEN RETURN false; END IF;
  IF phrase_hits >= 1 AND en_ratio > 0.05 AND NOT has_hu_signal THEN RETURN false; END IF;
  IF en_ratio > 0.12 THEN RETURN false; END IF;
  IF en_ratio > 0.06 AND hu_ratio < 0.01 AND dia_per100 < 1.0 THEN RETURN false; END IF;
  RETURN true;
END;
$$;

CREATE TEMP TABLE tmp_non_hu_episode_public_text_v4 AS
SELECT e.id FROM public.episodes e JOIN public.podcasts p ON p.id=e.podcast_id
WHERE p.language_decision='accept_hungarian'
  AND ((e.ai_summary IS NOT NULL AND length(trim(e.ai_summary))>=20 AND NOT public.is_hungarianish_public_ai_text(e.ai_summary))
    OR (e.summary IS NOT NULL AND length(trim(e.summary))>=20 AND NOT public.is_hungarianish_public_ai_text(e.summary))
    OR (e.seo_title IS NOT NULL AND length(trim(e.seo_title))>=20 AND NOT public.is_hungarianish_public_ai_text(e.seo_title))
    OR (e.seo_description IS NOT NULL AND length(trim(e.seo_description))>=20 AND NOT public.is_hungarianish_public_ai_text(e.seo_description)));

CREATE TEMP TABLE tmp_non_hu_podcast_public_text_v4 AS
SELECT p.id FROM public.podcasts p WHERE p.language_decision='accept_hungarian'
  AND ((p.summary IS NOT NULL AND length(trim(p.summary))>=20 AND NOT public.is_hungarianish_public_ai_text(p.summary))
    OR (p.seo_title IS NOT NULL AND length(trim(p.seo_title))>=20 AND NOT public.is_hungarianish_public_ai_text(p.seo_title))
    OR (p.seo_description IS NOT NULL AND length(trim(p.seo_description))>=20 AND NOT public.is_hungarianish_public_ai_text(p.seo_description)));

UPDATE public.episodes e SET
  ai_summary=CASE WHEN e.ai_summary IS NOT NULL AND length(trim(e.ai_summary))>=20 AND NOT public.is_hungarianish_public_ai_text(e.ai_summary) THEN NULL ELSE e.ai_summary END,
  ai_summary_source=CASE WHEN e.ai_summary IS NOT NULL AND length(trim(e.ai_summary))>=20 AND NOT public.is_hungarianish_public_ai_text(e.ai_summary) THEN NULL ELSE e.ai_summary_source END,
  summary=CASE WHEN e.summary IS NOT NULL AND length(trim(e.summary))>=20 AND NOT public.is_hungarianish_public_ai_text(e.summary) THEN NULL ELSE e.summary END,
  seo_title=CASE WHEN e.seo_title IS NOT NULL AND length(trim(e.seo_title))>=20 AND NOT public.is_hungarianish_public_ai_text(e.seo_title) THEN NULL ELSE e.seo_title END,
  seo_description=CASE WHEN e.seo_description IS NOT NULL AND length(trim(e.seo_description))>=20 AND NOT public.is_hungarianish_public_ai_text(e.seo_description) THEN NULL ELSE e.seo_description END,
  ai_enriched_at=NULL
FROM tmp_non_hu_episode_public_text_v4 bad WHERE bad.id=e.id;

UPDATE public.podcasts p SET
  summary=CASE WHEN p.summary IS NOT NULL AND length(trim(p.summary))>=20 AND NOT public.is_hungarianish_public_ai_text(p.summary) THEN NULL ELSE p.summary END,
  seo_title=CASE WHEN p.seo_title IS NOT NULL AND length(trim(p.seo_title))>=20 AND NOT public.is_hungarianish_public_ai_text(p.seo_title) THEN NULL ELSE p.seo_title END,
  seo_description=CASE WHEN p.seo_description IS NOT NULL AND length(trim(p.seo_description))>=20 AND NOT public.is_hungarianish_public_ai_text(p.seo_description) THEN NULL ELSE p.seo_description END,
  ai_enriched_at=NULL
FROM tmp_non_hu_podcast_public_text_v4 bad WHERE bad.id=p.id;

INSERT INTO public.ai_enrichment_jobs (kind, target_type, target_id, priority, input_hash, status, result)
SELECT 'seo_episode','episode', bad.id, 100, md5('non_hu_public_text_repair_episode_v4:'||bad.id::text), 'pending',
  jsonb_build_object('reason','non_hu_public_text_repair','source','migration_20260605010000')
FROM tmp_non_hu_episode_public_text_v4 bad
ON CONFLICT (kind, target_type, target_id, input_hash) DO NOTHING;

INSERT INTO public.ai_enrichment_jobs (kind, target_type, target_id, priority, input_hash, status, result)
SELECT 'seo_podcast','podcast', bad.id, 100, md5('non_hu_public_text_repair_podcast_v4:'||bad.id::text), 'pending',
  jsonb_build_object('reason','non_hu_public_text_repair','source','migration_20260605010000')
FROM tmp_non_hu_podcast_public_text_v4 bad
ON CONFLICT (kind, target_type, target_id, input_hash) DO NOTHING;

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'public_ai_language_guard_policy',
  jsonb_build_object('version',4,'language','hu','english_phrase_guard',true,'repair_job_source','migration_20260605010000'),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

DROP TABLE IF EXISTS tmp_non_hu_episode_public_text_v4;
DROP TABLE IF EXISTS tmp_non_hu_podcast_public_text_v4;

-- ====== 20260605013000 dead-person name-collision fail-closed ======
UPDATE public.people p SET
  is_public=false, is_indexable=false, is_browsable_in_people_hub=false, activation_status='inactive',
  ai_review_status='needs_human_review', ai_recommended_action='review', identity_ambiguous=true,
  wikipedia_match_status='needs_review', wikidata_id=null, wikipedia_title=null, wikipedia_url=null,
  wikipedia_extract=null, wikipedia_description=null,
  image_status=CASE WHEN p.image_url IS NOT NULL THEN 'needs_review' ELSE 'none' END,
  image_original_url=null, image_attribution=null, image_license=null,
  disambiguation_context='Halott/történelmi külső identitás ütközik podcast-szereplő bizonyítékkal.',
  browsable_reason='dead_person_name_collision_fail_closed_v1',
  editorial_notes=trim(both E'\n' from concat_ws(E'\n', nullif(p.editorial_notes,''), 'dead_person_name_collision_fail_closed_v1')),
  updated_at=now()
WHERE COALESCE(p.manual_approved,false)=false AND COALESCE(p.has_archival_evidence,false)=false
  AND (COALESCE(p.participant_count,0)+COALESCE(p.host_count,0)+COALESCE(p.guest_count,0))>0
  AND (p.is_deceased IS TRUE OR p.is_historical IS TRUE OR p.persona='historical'
       OR p.date_of_death IS NOT NULL OR p.is_living IS FALSE);

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'dead_person_name_collision_policy',
  jsonb_build_object('version',1,'rule','Dead/historical external identities never become ordinary podcast participants.'),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- ====== 20260605121000 clear stale unverified person external identity ======
UPDATE public.people p SET
  wikidata_id=NULL, wikipedia_title=NULL, wikipedia_url=NULL, wikipedia_extract=NULL, wikipedia_description=NULL,
  short_bio=CASE WHEN COALESCE(p.manual_approved,false)=false AND COALESCE(p.has_archival_evidence,false)=false
                  AND (p.wikidata_id IS NOT NULL OR p.wikipedia_title IS NOT NULL OR p.wikipedia_description IS NOT NULL OR p.wikipedia_extract IS NOT NULL)
                THEN NULL ELSE p.short_bio END,
  image_url=CASE WHEN p.image_source='wikimedia' OR p.image_original_url ILIKE '%wikimedia%' OR p.image_original_url ILIKE '%wikipedia%' THEN NULL ELSE p.image_url END,
  image_source=CASE WHEN p.image_source='wikimedia' OR p.image_original_url ILIKE '%wikimedia%' OR p.image_original_url ILIKE '%wikipedia%' THEN NULL ELSE p.image_source END,
  image_original_url=CASE WHEN p.image_source='wikimedia' OR p.image_original_url ILIKE '%wikimedia%' OR p.image_original_url ILIKE '%wikipedia%' THEN NULL ELSE p.image_original_url END,
  image_attribution=CASE WHEN p.image_source='wikimedia' OR p.image_original_url ILIKE '%wikimedia%' OR p.image_original_url ILIKE '%wikipedia%' THEN NULL ELSE p.image_attribution END,
  image_license=CASE WHEN p.image_source='wikimedia' OR p.image_original_url ILIKE '%wikimedia%' OR p.image_original_url ILIKE '%wikipedia%' THEN NULL ELSE p.image_license END,
  image_license_url=CASE WHEN p.image_source='wikimedia' OR p.image_original_url ILIKE '%wikimedia%' OR p.image_original_url ILIKE '%wikipedia%' THEN NULL ELSE p.image_license_url END,
  image_author=CASE WHEN p.image_source='wikimedia' OR p.image_original_url ILIKE '%wikimedia%' OR p.image_original_url ILIKE '%wikipedia%' THEN NULL ELSE p.image_author END,
  image_status=CASE WHEN p.image_source='wikimedia' OR p.image_original_url ILIKE '%wikimedia%' OR p.image_original_url ILIKE '%wikipedia%' THEN 'needs_review' ELSE p.image_status END,
  identity_ambiguous=CASE WHEN COALESCE(p.manual_approved,false)=false THEN true ELSE p.identity_ambiguous END,
  disambiguation_context=COALESCE(p.disambiguation_context,'Unverified external identity cleared.'),
  editorial_notes=trim(both E'\n' from concat_ws(E'\n', nullif(p.editorial_notes,''), 'clear_stale_unverified_person_external_identity_v1')),
  updated_at=now()
WHERE p.wikipedia_match_status IS DISTINCT FROM 'verified'
  AND (p.wikidata_id IS NOT NULL OR p.wikipedia_title IS NOT NULL OR p.wikipedia_url IS NOT NULL
       OR p.wikipedia_extract IS NOT NULL OR p.wikipedia_description IS NOT NULL
       OR p.image_source='wikimedia' OR p.image_original_url ILIKE '%wikimedia%' OR p.image_original_url ILIKE '%wikipedia%');

UPDATE public.people p SET
  short_bio=NULL,
  disambiguation_label=COALESCE(p.disambiguation_label,'pénzügyi és üzleti témákban szereplő Szabó László'),
  disambiguation_context='finance_business_name_collision', identity_ambiguous=true,
  editorial_notes=trim(both E'\n' from concat_ws(E'\n', nullif(p.editorial_notes,''), 'known_collision_szabo_laszlo_v2')),
  updated_at=now()
WHERE p.slug='szabo-laszlo' AND p.wikipedia_match_status IS DISTINCT FROM 'verified'
  AND (p.short_bio ILIKE '%filmrendező%' OR p.disambiguation_context IS DISTINCT FROM 'finance_business_name_collision');

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'person_external_identity_cleanup_policy',
  jsonb_build_object('version',1,'rule','Public person rows may use Wikidata/Wikipedia fields only when wikipedia_match_status=verified.'),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- ====== 20260605123000 org/person name collision guard ======
WITH organization_names AS (
  SELECT DISTINCT oa.normalized_alias, o.name AS organization_name, o.slug AS organization_slug
  FROM public.organization_aliases oa JOIN public.organizations o ON o.id=oa.organization_id
  WHERE oa.status='accepted' AND oa.normalized_alias IS NOT NULL
    AND COALESCE(o.is_public,true)=true AND COALESCE(o.is_indexable,true)=true
),
colliding_people AS (
  SELECT p.id, p.name, onm.organization_name, onm.organization_slug,
    (COALESCE(p.participant_count,0)+COALESCE(p.host_count,0)+COALESCE(p.guest_count,0)) AS person_evidence
  FROM public.people p JOIN organization_names onm ON onm.normalized_alias=p.normalized_name
  WHERE COALESCE(p.manual_approved,false)=false AND COALESCE(p.has_archival_evidence,false)=false
),
hidden_weak_people AS (
  UPDATE public.people p
  SET is_public=false, is_indexable=false, is_browsable_in_people_hub=false, activation_status='inactive',
      ai_recommended_action='reject', ai_review_status='reviewed', identity_ambiguous=true,
      disambiguation_context='Organization/person name collision.',
      browsable_reason='organization_person_name_collision_guard_v1',
      editorial_notes=trim(both E'\n' from concat_ws(E'\n', nullif(p.editorial_notes,''), 'organization_person_name_collision_guard_v1')),
      updated_at=now()
  FROM colliding_people cp WHERE p.id=cp.id AND cp.person_evidence=0 RETURNING p.id
),
review_people_with_evidence AS (
  UPDATE public.people p
  SET identity_ambiguous=true,
      ai_review_status=CASE WHEN COALESCE(p.ai_review_status,'')='reviewed' THEN p.ai_review_status ELSE 'needs_human_review' END,
      ai_recommended_action=CASE WHEN COALESCE(p.ai_recommended_action,'') IN ('hide','reject','merge') THEN p.ai_recommended_action ELSE 'review' END,
      disambiguation_context=COALESCE(p.disambiguation_context,'Organization/person name collision; review.'),
      editorial_notes=trim(both E'\n' from concat_ws(E'\n', nullif(p.editorial_notes,''), 'organization_person_name_collision_guard_v1: review')),
      updated_at=now()
  FROM colliding_people cp
  WHERE p.id=cp.id AND cp.person_evidence>0
    AND COALESCE(p.manual_approved,false)=false AND COALESCE(p.has_archival_evidence,false)=false
  RETURNING p.id
)
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'organization_person_name_collision_policy',
  jsonb_build_object('version',1,
    'hidden_weak_people_count', (SELECT count(*) FROM hidden_weak_people),
    'review_people_with_evidence_count', (SELECT count(*) FROM review_people_with_evidence),
    'rule','Accepted org aliases take precedence over unapproved person rows.'),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();
