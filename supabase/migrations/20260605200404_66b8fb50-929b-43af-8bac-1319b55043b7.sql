-- Reassert the production-facing rule behind the people hub: a dead or
-- historical entity can be a topic, but it is not a public podcast-person
-- profile unless an editor explicitly marks archival/manual evidence.

WITH suspicious_temporal_participants AS (
  UPDATE public.people p
  SET
    date_of_death = NULL,
    is_living = NULL,
    wikidata_id = NULL,
    wikipedia_title = NULL,
    wikipedia_url = NULL,
    wikipedia_extract = NULL,
    wikipedia_description = NULL,
    wikipedia_match_status = 'needs_review',
    wikipedia_match_confidence = 0,
    image_status = CASE WHEN p.image_url IS NOT NULL THEN 'needs_review' ELSE COALESCE(p.image_status, 'none') END,
    image_original_url = NULL,
    image_attribution = NULL,
    image_license = NULL,
    identity_ambiguous = true,
    ai_review_status = 'needs_human_review',
    editorial_notes = trim(both E'\n' from concat_ws(
      E'\n',
      nullif(p.editorial_notes, ''),
      'temporal_person_public_guard_v5: cleared unsupported death/living metadata because podcast participant evidence conflicts with an unapproved external temporal identity.'
    )),
    updated_at = now()
  WHERE COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
    AND COALESCE(p.is_deceased, false) = false
    AND COALESCE(p.is_historical, false) = false
    AND COALESCE(p.persona, '') <> 'historical'
    AND (p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
    AND (
      COALESCE(p.participant_count, 0)
      + COALESCE(p.host_count, 0)
      + COALESCE(p.guest_count, 0)
    ) > 0
  RETURNING p.id
),
demoted_temporal_people AS (
  UPDATE public.people p
  SET
    is_public = false,
    is_indexable = false,
    is_browsable_in_people_hub = false,
    activation_status = 'inactive',
    ai_recommended_action = CASE
      WHEN (COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0)) > 0 THEN 'review'
      ELSE 'hide'
    END,
    ai_review_status = CASE
      WHEN (COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0)) > 0 THEN 'needs_human_review'
      ELSE COALESCE(p.ai_review_status, 'reviewed')
    END,
    identity_ambiguous = CASE
      WHEN (COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0)) > 0 THEN true
      ELSE COALESCE(p.identity_ambiguous, false)
    END,
    browsable_reason = 'temporal_person_public_guard_v5',
    editorial_notes = trim(both E'\n' from concat_ws(
      E'\n',
      nullif(p.editorial_notes, ''),
      'temporal_person_public_guard_v5: hidden because deceased/historical/date_of_death rows are not podcast-person profiles without manual_approved or has_archival_evidence.'
    )),
    updated_at = now()
  WHERE COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
    AND (
      p.is_deceased IS TRUE OR p.is_historical IS TRUE OR p.persona = 'historical'
      OR (p.date_of_death IS NOT NULL AND (COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0)) = 0)
      OR (p.is_living IS FALSE AND (COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0)) = 0)
    )
    AND (
      p.is_public IS TRUE OR p.is_indexable IS TRUE OR p.is_browsable_in_people_hub IS TRUE
      OR p.activation_status <> 'inactive' OR COALESCE(p.ai_recommended_action, '') NOT IN ('hide', 'review')
    )
  RETURNING p.id
),
rejected_temporal_aliases AS (
  UPDATE public.person_aliases pa
  SET status = 'rejected', source = 'temporal_person_public_guard_v5'
  FROM public.people p
  WHERE pa.person_id = p.id
    AND COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
    AND (
      p.is_deceased IS TRUE OR p.is_historical IS TRUE OR p.persona = 'historical'
      OR (p.date_of_death IS NOT NULL AND (COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0)) = 0)
      OR (p.is_living IS FALSE AND (COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0)) = 0)
    )
  RETURNING pa.id
)
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'temporal_person_public_guard_policy',
  jsonb_build_object(
    'version', 5,
    'demoted_temporal_people_count', (SELECT count(*) FROM demoted_temporal_people),
    'cleared_suspicious_temporal_participant_count', (SELECT count(*) FROM suspicious_temporal_participants),
    'rejected_temporal_alias_count', (SELECT count(*) FROM rejected_temporal_aliases),
    'rule', 'Dead, historical, date_of_death or is_living=false rows are not public/indexable podcast-person profiles without manual_approved or has_archival_evidence.',
    'updated_at', now()
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- ====== 2+4/6: recommendation_compatibility_v5 + content_bridge reassert ======
CREATE OR REPLACE FUNCTION public.recommendation_has_content_bridge(
  p_source_topics text[], p_candidate_topics text[],
  p_source_people text[], p_candidate_people text[],
  p_source_companies text[], p_candidate_companies text[]
) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM unnest(coalesce(p_source_topics, ARRAY[]::text[])) s(value)
    JOIN unnest(coalesce(p_candidate_topics, ARRAY[]::text[])) c(value) ON lower(s.value) = lower(c.value))
  OR EXISTS (SELECT 1 FROM unnest(coalesce(p_source_people, ARRAY[]::text[])) s(value)
    JOIN unnest(coalesce(p_candidate_people, ARRAY[]::text[])) c(value) ON lower(s.value) = lower(c.value))
  OR EXISTS (SELECT 1 FROM unnest(coalesce(p_source_companies, ARRAY[]::text[])) s(value)
    JOIN unnest(coalesce(p_candidate_companies, ARRAY[]::text[])) c(value) ON lower(s.value) = lower(c.value));
$function$;

CREATE OR REPLACE FUNCTION public.recommendation_is_compatible(
  p_source_group text, p_candidate_group text, p_similarity double precision, p_has_topic_bridge boolean
) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN (p_source_group = 'religion') <> (p_candidate_group = 'religion') THEN false
    WHEN p_candidate_group = 'children' AND p_source_group <> 'children' THEN false
    WHEN p_source_group = 'children' AND p_candidate_group <> 'children' AND NOT p_has_topic_bridge THEN false
    WHEN p_source_group <> 'general' AND p_candidate_group <> 'general' AND p_source_group <> p_candidate_group THEN p_has_topic_bridge
    WHEN p_source_group <> 'general' AND p_candidate_group = 'general' THEN p_has_topic_bridge
    WHEN p_candidate_group <> 'general' AND p_source_group = 'general' THEN p_has_topic_bridge
    WHEN p_source_group <> 'general' AND p_source_group = p_candidate_group THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.70
    ELSE p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.82
  END;
$function$;

CREATE OR REPLACE FUNCTION public.get_related_episodes_by_embedding(
  p_episode_id uuid, p_limit integer DEFAULT 8, p_downweight_same_podcast boolean DEFAULT true
) RETURNS TABLE(
  episode_id uuid, podcast_id uuid, similarity double precision, final_score double precision,
  title text, display_title text, slug text, ai_summary text, summary text, description text,
  published_at timestamp with time zone, audio_url text, image_url text, topics text[],
  podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text,
  podcast_category text, podiverzum_rank numeric, rank_label text, related_reason text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  src_embedding vector(768); src_podcast_id uuid;
  src_topics text[]; src_people text[]; src_companies text[]; src_group text;
BEGIN
  SELECT ee.embedding, ee.podcast_id INTO src_embedding, src_podcast_id
  FROM episode_embeddings ee WHERE ee.episode_id = p_episode_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;
  SELECT COALESCE(e.topics, '{}'), COALESCE(e.people, '{}') || COALESCE(e.mentioned, '{}'),
         COALESCE(e.companies, '{}'),
         public.recommendation_text_group(e.title, pod.title, pod.category, e.topics)
  INTO src_topics, src_people, src_companies, src_group
  FROM episodes e JOIN podcasts pod ON pod.id = e.podcast_id WHERE e.id = p_episode_id;

  RETURN QUERY
  WITH ep_cand AS (
    SELECT ee.episode_id AS eid, ee.podcast_id AS pid, (1 - (ee.embedding <=> src_embedding))::float AS sim
    FROM episode_embeddings ee WHERE ee.episode_id <> p_episode_id
    ORDER BY ee.embedding <=> src_embedding LIMIT 260
  ),
  chunk_cand AS (
    SELECT DISTINCT ON (ec.episode_id) ec.episode_id AS eid, ec.podcast_id AS pid,
           (1 - (ec.embedding <=> src_embedding))::float AS sim
    FROM episode_chunks ec WHERE ec.episode_id <> p_episode_id
    ORDER BY ec.episode_id, ec.embedding <=> src_embedding LIMIT 260
  ),
  pool AS (SELECT eid, pid, max(sim) AS sim FROM (SELECT * FROM ep_cand UNION ALL SELECT * FROM chunk_cand) u GROUP BY eid, pid),
  cand AS (
    SELECT e.id AS eid, e.podcast_id AS pid, p.sim,
      e.title, e.display_title, e.slug, e.ai_summary, e.summary, e.description,
      e.published_at, e.audio_url, e.image_url, COALESCE(e.topics, ARRAY[]::text[]) AS topics,
      COALESCE(e.people, ARRAY[]::text[]) || COALESCE(e.mentioned, ARRAY[]::text[]) AS people_all,
      COALESCE(e.companies, ARRAY[]::text[]) AS companies,
      pod.slug AS p_slug, pod.title AS p_title, pod.display_title AS p_display_title,
      pod.image_url AS p_image, pod.category AS p_category,
      pod.podiverzum_rank AS p_rank, pod.rank_label AS p_rank_label,
      (e.podcast_id = src_podcast_id) AS same_pod,
      public.recommendation_has_content_bridge(
        src_topics, e.topics, src_people, COALESCE(e.people, ARRAY[]::text[]) || COALESCE(e.mentioned, ARRAY[]::text[]),
        src_companies, e.companies) AS content_bridge,
      public.recommendation_text_group(e.title, pod.title, pod.category, e.topics) AS candidate_group
    FROM pool p JOIN episodes e ON e.id = p.eid JOIN podcasts pod ON pod.id = e.podcast_id
    WHERE pod.is_hungarian = true AND pod.language_decision = 'accept_hungarian'
      AND COALESCE(pod.rss_status,'healthy') NOT IN ('failed','inactive') AND e.audio_url IS NOT NULL
  ),
  scored AS (
    SELECT c.*,
      COALESCE(array_length(ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(c.topics)), 1), 0) AS topic_overlap,
      COALESCE(array_length(ARRAY(SELECT unnest(src_people) INTERSECT SELECT unnest(c.people_all)), 1), 0) AS people_overlap,
      COALESCE(array_length(ARRAY(SELECT unnest(src_companies) INTERSECT SELECT unnest(c.companies)), 1), 0) AS company_overlap,
      (c.sim * 1.0
        + CASE c.p_rank_label WHEN 'S' THEN 0.05 WHEN 'A' THEN 0.03 WHEN 'B' THEN 0.015 ELSE 0 END
        + CASE WHEN c.published_at IS NOT NULL AND c.published_at > now() - interval '180 days' THEN 0.03 ELSE 0 END
        + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(c.topics)), 1), 0) * 0.05, 0.15)
        + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_people) INTERSECT SELECT unnest(c.people_all)), 1), 0) * 0.08, 0.20)
        + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_companies) INTERSECT SELECT unnest(c.companies)), 1), 0) * 0.07, 0.18)
        - CASE WHEN COALESCE(length(coalesce(c.ai_summary, c.summary, c.description)),0) < 80 THEN 0.05 ELSE 0 END
      )::float AS fscore
    FROM cand c WHERE (p_downweight_same_podcast = false OR c.same_pod = false)
      AND public.recommendation_is_compatible(src_group, c.candidate_group, c.sim, c.content_bridge)
  ),
  diversified AS (SELECT s.*, row_number() OVER (PARTITION BY s.pid ORDER BY s.fscore DESC) AS rn_per_pod FROM scored s)
  SELECT d.eid, d.pid, d.sim, d.fscore, d.title, d.display_title, d.slug, d.ai_summary, d.summary, d.description,
    d.published_at, d.audio_url, d.image_url, d.topics, d.p_slug, d.p_title, d.p_display_title, d.p_image, d.p_category,
    d.p_rank, d.p_rank_label,
    CASE
      WHEN d.people_overlap > 0 THEN 'Kapcsolódó személyek alapján.'
      WHEN d.company_overlap > 0 THEN 'Kapcsolódó szervezet vagy márka alapján.'
      WHEN d.topic_overlap > 0 THEN 'Hasonló témák: ' || array_to_string((ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(d.topics)))[1:3], ', ')
      WHEN d.sim >= 0.82 THEN 'Erős tartalmi közelség az epizód-index alapján.'
      ELSE 'Tartalmilag rokon epizód.'
    END AS related_reason
  FROM diversified d WHERE d.rn_per_pod = 1 AND d.sim >= 0.50
  ORDER BY d.fscore DESC LIMIT GREATEST(p_limit, 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.similar_episodes(p_episode_id uuid, p_limit integer DEFAULT 6)
RETURNS TABLE(
  episode_id uuid, podcast_id uuid, similarity double precision,
  title text, display_title text, slug text, ai_summary text, summary text, description text,
  published_at timestamp with time zone, audio_url text, topics text[],
  podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text,
  podcast_category text, podiverzum_rank numeric, rank_label text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  src_embedding vector(768); src_podcast_id uuid;
  src_topics text[]; src_people text[]; src_companies text[]; src_group text;
BEGIN
  SELECT ee.embedding, ee.podcast_id INTO src_embedding, src_podcast_id
  FROM episode_embeddings ee WHERE ee.episode_id = p_episode_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;
  SELECT COALESCE(e.topics, '{}'), COALESCE(e.people, '{}') || COALESCE(e.mentioned, '{}'),
         COALESCE(e.companies, '{}'), public.recommendation_text_group(e.title, pod.title, pod.category, e.topics)
  INTO src_topics, src_people, src_companies, src_group
  FROM episodes e JOIN podcasts pod ON pod.id = e.podcast_id WHERE e.id = p_episode_id;

  RETURN QUERY
  WITH ep_cand AS (
    SELECT ee.episode_id AS eid, ee.podcast_id AS pid, (1 - (ee.embedding <=> src_embedding))::float AS sim
    FROM episode_embeddings ee WHERE ee.episode_id <> p_episode_id
      AND ee.podcast_id <> COALESCE(src_podcast_id,'00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY ee.embedding <=> src_embedding LIMIT 260
  ),
  chunk_cand AS (
    SELECT DISTINCT ON (ec.episode_id) ec.episode_id AS eid, ec.podcast_id AS pid,
           (1 - (ec.embedding <=> src_embedding))::float AS sim
    FROM episode_chunks ec WHERE ec.episode_id <> p_episode_id
      AND ec.podcast_id <> COALESCE(src_podcast_id,'00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY ec.episode_id, ec.embedding <=> src_embedding LIMIT 260
  ),
  pool AS (SELECT eid, pid, max(sim) AS sim FROM (SELECT * FROM ep_cand UNION ALL SELECT * FROM chunk_cand) u GROUP BY eid, pid),
  scored AS (
    SELECT e.id AS eid, e.podcast_id AS pid, p.sim,
      e.title, e.display_title, e.slug, e.ai_summary, e.summary, e.description,
      e.published_at, e.audio_url, COALESCE(e.topics, ARRAY[]::text[]) AS topics,
      pod.slug AS p_slug, pod.title AS p_title, pod.display_title AS p_display_title,
      pod.image_url AS p_image, pod.category AS p_category,
      pod.podiverzum_rank AS p_rank, pod.rank_label AS p_rank_label,
      (p.sim
        + CASE pod.rank_label WHEN 'S' THEN 0.05 WHEN 'A' THEN 0.03 WHEN 'B' THEN 0.015 ELSE 0 END
        + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(e.topics)), 1), 0) * 0.05, 0.15)
        + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_people) INTERSECT SELECT unnest(COALESCE(e.people, ARRAY[]::text[]) || COALESCE(e.mentioned, ARRAY[]::text[]))), 1), 0) * 0.08, 0.20)
        + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_companies) INTERSECT SELECT unnest(e.companies)), 1), 0) * 0.07, 0.18)
      )::float AS fscore
    FROM pool p JOIN episodes e ON e.id = p.eid JOIN podcasts pod ON pod.id = e.podcast_id
    WHERE pod.is_hungarian = true AND pod.language_decision = 'accept_hungarian'
      AND COALESCE(pod.rss_status,'healthy') NOT IN ('failed','inactive') AND e.audio_url IS NOT NULL
      AND public.recommendation_is_compatible(
        src_group, public.recommendation_text_group(e.title, pod.title, pod.category, e.topics), p.sim,
        public.recommendation_has_content_bridge(src_topics, e.topics, src_people,
          COALESCE(e.people, ARRAY[]::text[]) || COALESCE(e.mentioned, ARRAY[]::text[]), src_companies, e.companies))
  ),
  diversified AS (SELECT s.*, row_number() OVER (PARTITION BY s.pid ORDER BY s.fscore DESC) AS rn_per_pod FROM scored s)
  SELECT d.eid, d.pid, d.sim, d.title, d.display_title, d.slug, d.ai_summary, d.summary, d.description,
    d.published_at, d.audio_url, d.topics, d.p_slug, d.p_title, d.p_display_title, d.p_image, d.p_category,
    d.p_rank, d.p_rank_label
  FROM diversified d WHERE d.rn_per_pod = 1 AND d.sim >= 0.50
  ORDER BY d.fscore DESC LIMIT GREATEST(p_limit, 1);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.recommendation_has_content_bridge(text[], text[], text[], text[], text[], text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recommendation_is_compatible(text, text, double precision, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_related_episodes_by_embedding(uuid, integer, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.similar_episodes(uuid, integer) TO anon, authenticated, service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('related_episode_quality_policy', jsonb_build_object(
    'version', 5,
    'religion_cross_group', 'hard_block',
    'children_cross_group', 'hard_block_except_children_source_with_explicit_bridge',
    'different_specific_groups', 'explicit_bridge_required',
    'specific_to_general', 'explicit_bridge_required',
    'general_to_specific', 'explicit_bridge_required',
    'same_specific_group_min_similarity_without_bridge', 0.70,
    'general_min_similarity_without_bridge', 0.82,
    'bridge_sources', jsonb_build_array('topics', 'people', 'mentioned', 'companies')
  ), now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- ====== 5/6: episode_article_candidates_readonly_policy ======
DO $$
BEGIN
  IF to_regclass('public.episode_article_candidates') IS NOT NULL THEN
    DROP POLICY IF EXISTS "episode article candidates readonly verifier read" ON public.episode_article_candidates;
    CREATE POLICY "episode article candidates readonly verifier read"
      ON public.episode_article_candidates FOR SELECT USING (current_user = 'readonly_codex');
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
      GRANT SELECT ON public.episode_article_candidates TO readonly_codex;
    END IF;
  END IF;
END $$;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('episode_article_candidate_readonly_policy', jsonb_build_object(
    'version', 1, 'policy', 'episode article candidates readonly verifier read',
    'role', 'readonly_codex', 'reason', 'Production pipeline verifier must see persisted article candidates despite RLS.',
    'updated_at', now()), now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- ====== 6/6: strict_temporal_person_guard_v6 ======
WITH demoted_temporal_people AS (
  UPDATE public.people p
  SET is_public = false, is_indexable = false, is_browsable_in_people_hub = false, activation_status = 'inactive',
    ai_recommended_action = CASE WHEN (COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0)) > 0 THEN 'review' ELSE 'hide' END,
    ai_review_status = CASE WHEN (COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0)) > 0 THEN 'needs_human_review' ELSE COALESCE(p.ai_review_status, 'reviewed') END,
    identity_ambiguous = CASE WHEN (COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0)) > 0 THEN true ELSE COALESCE(p.identity_ambiguous, false) END,
    browsable_reason = 'strict_temporal_person_guard_v6',
    editorial_notes = trim(both E'\n' from concat_ws(E'\n', nullif(p.editorial_notes, ''),
      'strict_temporal_person_guard_v6: hidden because deceased/historical/date_of_death rows are not podcast-person profiles without manual_approved or has_archival_evidence; participant counters can be title/subject collisions.')),
    updated_at = now()
  WHERE COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
    AND (p.is_deceased IS TRUE OR p.is_historical IS TRUE OR p.persona = 'historical' OR p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
    AND (p.is_public IS TRUE OR p.is_indexable IS TRUE OR p.is_browsable_in_people_hub IS TRUE
         OR p.activation_status <> 'inactive' OR COALESCE(p.ai_recommended_action, '') NOT IN ('hide', 'review')
         OR ((COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0)) > 0 AND COALESCE(p.ai_review_status, '') <> 'needs_human_review'))
  RETURNING p.id
),
rejected_temporal_aliases AS (
  UPDATE public.person_aliases pa
  SET status = 'rejected', source = 'strict_temporal_person_guard_v6'
  FROM public.people p
  WHERE pa.person_id = p.id AND COALESCE(p.manual_approved, false) = false AND COALESCE(p.has_archival_evidence, false) = false
    AND (p.is_deceased IS TRUE OR p.is_historical IS TRUE OR p.persona = 'historical' OR p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
  RETURNING pa.id
)
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('temporal_person_public_guard_policy', jsonb_build_object(
    'version', 6,
    'demoted_temporal_people_count', (SELECT count(*) FROM demoted_temporal_people),
    'rejected_temporal_alias_count', (SELECT count(*) FROM rejected_temporal_aliases),
    'rule', 'Dead, historical, date_of_death or is_living=false rows are not public/indexable podcast-person profiles without manual_approved or has_archival_evidence.',
    'participant_collision_rule', 'Fail closed: participant/host/guest counters do not override temporal identity evidence.',
    'updated_at', now()), now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();