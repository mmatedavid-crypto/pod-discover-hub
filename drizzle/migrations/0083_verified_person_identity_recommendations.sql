-- A matching display name is not a shared identity. Person links used for recommendations,
-- explanations, episode person chips and structured data require an accepted, reviewed
-- (validation_source set) person_episode_mentions row on a trustworthy canonical person.

CREATE OR REPLACE FUNCTION public.person_link_trusted_v1(p_person_id uuid, p_validation_source text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p_validation_source IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.people p
     WHERE p.id = p_person_id
       AND p.is_public IS TRUE
       AND coalesce(p.identity_status, 'normal') IN ('normal', 'confirmed', 'context_resolved')
       AND coalesce(p.ai_review_status, '') NOT IN ('needs_human_review', 'duplicate_candidate')
       AND coalesce(p.ai_recommended_action, '') NOT IN ('hide', 'reject')
       AND coalesce(p.activation_status, '') NOT IN ('inactive', 'hidden', 'rejected')
       AND NOT (coalesce(p.identity_ambiguous, false) AND NOT coalesce(p.manual_approved, false)));
$$;

CREATE OR REPLACE FUNCTION public.verified_episode_person_ids_v1(p_episode_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(array_agg(DISTINCT m.person_id), ARRAY[]::uuid[])
    FROM public.person_episode_mentions m
   WHERE m.episode_id = p_episode_id
     AND m.relevance_status = 'accepted'
     AND public.person_link_trusted_v1(m.person_id, m.validation_source);
$$;

CREATE OR REPLACE FUNCTION public.verified_person_overlap_v1(p_source_person_ids uuid[], p_episode_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN coalesce(cardinality(p_source_person_ids), 0) = 0 THEN 0 ELSE (
    SELECT count(DISTINCT m.person_id)::int
      FROM public.person_episode_mentions m
     WHERE m.episode_id = p_episode_id
       AND m.person_id = ANY(p_source_person_ids)
       AND m.relevance_status = 'accepted'
       AND m.validation_source IS NOT NULL) END;
$$;

-- Shared verified people between a source episode and candidates (or, with no candidate
-- list, the most recent other HU episodes sharing a verified person).
CREATE OR REPLACE FUNCTION public.get_shared_verified_people_v1(p_episode_id uuid, p_candidate_ids uuid[] DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS TABLE(episode_id uuid, person_id uuid, person_name text, person_slug text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '5s' AS $$
  WITH src AS (SELECT unnest(public.verified_episode_person_ids_v1(p_episode_id)) AS pid)
  SELECT m.episode_id, m.person_id, p.name, p.slug
    FROM public.person_episode_mentions m
    JOIN src ON src.pid = m.person_id
    JOIN public.people p ON p.id = m.person_id
    JOIN public.episodes e ON e.id = m.episode_id
    JOIN public.podcasts pod ON pod.id = e.podcast_id
   WHERE m.episode_id <> p_episode_id
     AND m.relevance_status = 'accepted'
     AND m.validation_source IS NOT NULL
     AND (p_candidate_ids IS NULL OR m.episode_id = ANY(p_candidate_ids))
     AND pod.language_decision = 'accept_hungarian'
     AND e.audio_url IS NOT NULL
   ORDER BY e.published_at DESC NULLS LAST
   LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
$$;

-- People on an episode that may be linked: never rejected/needs_review; `verified` = accepted,
-- reviewed and trustworthy. An unreviewed name match is only linkable when that person has no
-- verified episode elsewhere, so a namesake is never attached to a verified identity.
CREATE OR REPLACE FUNCTION public.get_episode_person_links_v1(p_episode_id uuid)
RETURNS TABLE(person_id uuid, verified boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '5s' AS $$
  SELECT x.person_id, x.verified FROM (
    SELECT m.person_id,
           bool_or(m.relevance_status = 'accepted' AND public.person_link_trusted_v1(m.person_id, m.validation_source)) AS verified
      FROM public.person_episode_mentions m
     WHERE m.episode_id = p_episode_id
       AND coalesce(m.relevance_status, 'pending') NOT IN ('rejected', 'needs_review')
     GROUP BY m.person_id) x
   WHERE x.verified
      OR NOT EXISTS (SELECT 1 FROM public.person_episode_mentions a
                      WHERE a.person_id = x.person_id AND a.episode_id <> p_episode_id
                        AND a.relevance_status = 'accepted' AND a.validation_source IS NOT NULL)
   LIMIT 40;
$$;

GRANT EXECUTE ON FUNCTION public.person_link_trusted_v1(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verified_episode_person_ids_v1(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verified_person_overlap_v1(uuid[], uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_shared_verified_people_v1(uuid, uuid[], integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_episode_person_links_v1(uuid) TO anon, authenticated, service_role;

-- Rewire the recommendation RPCs in place: raw people[]/mentioned[] names no longer bridge,
-- score or explain; only verified shared person ids do. Topic/company/category logic unchanged.
CREATE FUNCTION pg_temp.chk_replace(p_src text, p_from text, p_to text, p_expected int, p_label text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int := (length(p_src) - length(replace(p_src, p_from, ''))) / greatest(length(p_from), 1);
BEGIN
  IF n <> p_expected THEN RAISE EXCEPTION 'chk_replace %: expected % occurrence(s), found %', p_label, p_expected, n; END IF;
  RETURN replace(p_src, p_from, p_to);
END $$;

DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.similar_episodes(uuid,integer)'::regprocedure);
  d := pg_temp.chk_replace(d, 'src_group text;', 'src_group text; src_person_ids uuid[];', 1, 'sim declare');
  d := pg_temp.chk_replace(d, 'FROM episodes e JOIN podcasts pod ON pod.id=e.podcast_id WHERE e.id=p_episode_id;',
    'FROM episodes e JOIN podcasts pod ON pod.id=e.podcast_id WHERE e.id=p_episode_id;
  src_person_ids := public.verified_episode_person_ids_v1(p_episode_id);
  src_people := ARRAY[]::text[];', 1, 'sim src');
  d := pg_temp.chk_replace(d, 'COALESCE(array_length(ARRAY(SELECT unnest(src_people) INTERSECT SELECT unnest(COALESCE(e.people, ARRAY[]::text[])||COALESCE(e.mentioned, ARRAY[]::text[]))),1),0)',
    'public.verified_person_overlap_v1(src_person_ids, e.id)', 2, 'sim overlap');
  d := pg_temp.chk_replace(d, 'src_companies, e.companies)))',
    'src_companies, e.companies) OR public.verified_person_overlap_v1(src_person_ids, e.id) > 0))', 1, 'sim bridge');
  EXECUTE d;

  d := pg_get_functiondef('public.get_related_episodes_by_embedding(uuid,integer,boolean)'::regprocedure);
  d := pg_temp.chk_replace(d, 'src_group text;', 'src_group text; src_person_ids uuid[];', 1, 'rel declare');
  d := pg_temp.chk_replace(d, 'FROM episodes e JOIN podcasts pod ON pod.id=e.podcast_id WHERE e.id=p_episode_id;',
    'FROM episodes e JOIN podcasts pod ON pod.id=e.podcast_id WHERE e.id=p_episode_id;
  src_person_ids := public.verified_episode_person_ids_v1(p_episode_id);
  src_people := ARRAY[]::text[];', 1, 'rel src');
  d := pg_temp.chk_replace(d, 'COALESCE(array_length(ARRAY(SELECT unnest(src_people) INTERSECT SELECT unnest(c.people_all)),1),0)',
    'public.verified_person_overlap_v1(src_person_ids, c.eid)', 2, 'rel overlap');
  d := pg_temp.chk_replace(d, 'src_companies, e.companies) AS content_bridge',
    'src_companies, e.companies) OR public.verified_person_overlap_v1(src_person_ids, e.id) > 0 AS content_bridge', 1, 'rel bridge');
  EXECUTE d;

  d := pg_get_functiondef('public.smart_player_discover(uuid,integer)'::regprocedure);
  d := pg_temp.chk_replace(d, 'pem.relevance_status = ''accepted''',
    'pem.relevance_status = ''accepted'' AND public.person_link_trusted_v1(pem.person_id, pem.validation_source)', 2, 'discover');
  EXECUTE d;
END $mig$;

-- Health: intentional pauses / budget stops / cooldowns are reported as paused, never as an outage.
CREATE OR REPLACE FUNCTION public.runner_pause_reason_v1(p_runner text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_key text := CASE p_runner
    WHEN 'entity-backfill-runner' THEN 'entity_backfill_controls'
    WHEN 'seo-enrich-runner' THEN 'ai_seo_controls'
    WHEN 'episode-topic-extractor' THEN 'episode_topic_extractor_controls'
    WHEN 'person-entity-extractor' THEN 'person_entity_extractor_controls'
    WHEN 'episode-best-text-source-runner' THEN 'episode_best_text_source_controls' END;
  v_ctrl jsonb; v_bg jsonb; v_spend jsonb; v_spent numeric; v_budget numeric;
BEGIN
  SELECT value INTO v_bg FROM public.app_settings WHERE key = 'background_jobs';
  IF coalesce((v_bg->>'enabled')::boolean, true) IS FALSE OR coalesce((v_bg->>'incident_mode')::boolean, false) THEN
    RETURN 'Background jobs kill switch is on (app_settings.background_jobs).';
  END IF;
  IF v_key IS NULL THEN RETURN NULL; END IF;
  SELECT value INTO v_ctrl FROM public.app_settings WHERE key = v_key;
  v_ctrl := coalesce(v_ctrl, '{}'::jsonb);
  IF (v_ctrl->>'enabled') = 'false' THEN
    RETURN 'Paused' || coalesce(' by ' || nullif(v_ctrl->>'auto_paused_by', ''), '') || ': '
      || coalesce(nullif(v_ctrl->>'auto_paused_reason', ''), nullif(v_ctrl->>'paused_reason', ''), 'disabled in ' || v_key) || '.';
  END IF;
  IF nullif(v_ctrl->>'cooldown_until', '') IS NOT NULL AND (v_ctrl->>'cooldown_until')::timestamptz > now() THEN
    RETURN 'Provider quota cooldown until ' || (v_ctrl->>'cooldown_until') || '.';
  END IF;
  v_budget := nullif(v_ctrl->>'daily_budget_usd', '')::numeric;
  IF v_budget IS NOT NULL THEN
    IF p_runner = 'episode-topic-extractor' THEN
      SELECT coalesce(sum(cost_usd), 0) INTO v_spent FROM public.ai_runs
       WHERE runner = 'episode-topic-extractor' AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    ELSE
      SELECT by_kind INTO v_spend FROM public.ai_spend_daily WHERE day = (now() AT TIME ZONE 'UTC')::date;
      v_spent := nullif(v_spend->>(CASE p_runner WHEN 'entity-backfill-runner' THEN 'entity_backfill' WHEN 'seo-enrich-runner' THEN 'seo_enrich' END), '')::numeric;
    END IF;
    IF v_spent IS NOT NULL AND v_spent >= v_budget THEN
      RETURN 'Daily budget reached ($' || round(v_spent, 2) || ' / $' || v_budget || '); resumes next UTC day.';
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.runner_pause_reason_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runner_pause_reason_v1(text) TO service_role;

DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.pipeline_runner_health_item_v1(text,text,text,bigint,text,interval,text)'::regprocedure);
  d := pg_temp.chk_replace(d, '  IF p_paused_reason IS NOT NULL THEN',
    '  p_paused_reason := coalesce(p_paused_reason, public.runner_pause_reason_v1(p_runner));
  IF p_paused_reason IS NOT NULL THEN', 1, 'runner paused');
  EXECUTE d;

  -- Derivation freshness: a reached daily dispatch cap with nothing queued is a planned stop;
  -- red stays for queued work that does not complete, or dispatch that stopped below the cap.
  d := pg_get_functiondef('public.derivation_health_item_v1()'::regprocedure);
  d := pg_temp.chk_replace(d, '  ELSIF (v_stale + v_queued) > 0 AND (v_last IS NULL OR v_last < now() - interval ''3 hours'') THEN
    v_health := ''red''; v_rec := ''Stale/queued derived results but no stage completed in 3h.'';',
    '  ELSIF v_queued > 0 AND (v_last IS NULL OR v_last < now() - interval ''3 hours'') THEN
    v_health := ''red''; v_rec := ''Queued derived results but no stage completed in 3h; check the entity/topic/SEO runners.'';
  ELSIF v_stale > 0 AND v_queued = 0 AND (v_disp->>''day'') = to_char((now() AT TIME ZONE ''UTC'')::date, ''YYYY-MM-DD'')
        AND coalesce((v_disp->>''dispatched_today'')::int, 0) >= coalesce((v_ctrl->>''daily_cap'')::int, 0) THEN
    v_health := ''paused''; v_rec := ''Daily dispatch cap reached ('' || (v_disp->>''dispatched_today'') || ''/'' || (v_ctrl->>''daily_cap'') || ''); stale results continue next UTC day.'';
  ELSIF v_stale > 0 AND (nullif(v_disp->>''last_at'', '''') IS NULL OR (v_disp->>''last_at'')::timestamptz < now() - interval ''3 hours'') THEN
    v_health := ''red''; v_rec := ''Stale derived results below the daily cap but nothing dispatched in 3h; check the dispatch caller.'';', 1, 'derivation health');
  EXECUTE d;
END $mig$;