-- Owner-approved (2026-10-29): short Hungarian organization/person descriptions written by the cheap
-- OpenAI Batch model from public episode titles/RSS card summaries only, every claim backed by a
-- verbatim quote. Organizations publish automatically (CAS onto empty fields, backup, rollback);
-- persons are a 200-draft trial that is never published without a separate owner decision.

CREATE TABLE public.entity_description_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('organization','person')),
  status text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','uploading','submitted','validating','in_progress','finalizing','completed','failed','expired','cancelling','cancelled','ingesting','ingested','aborted')),
  model text NOT NULL,
  prompt_version text NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  reserved_cost_usd numeric NOT NULL DEFAULT 0,
  actual_cost_usd numeric,
  openai_input_file_id text,
  openai_batch_id text,
  openai_output_file_id text,
  openai_error_file_id text,
  last_error text,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  ingested_at timestamptz,
  rolled_back_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT ALL ON public.entity_description_jobs TO service_role;
REVOKE ALL ON public.entity_description_jobs FROM anon, authenticated;
ALTER TABLE public.entity_description_jobs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.entity_description_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.entity_description_jobs(id) ON DELETE CASCADE,
  entity_kind text NOT NULL CHECK (entity_kind IN ('organization','person')),
  entity_id uuid NOT NULL,
  custom_id text NOT NULL UNIQUE,
  attempt integer NOT NULL DEFAULT 1,
  source_hash text NOT NULL,
  source jsonb NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','verified','rejected','failed','applied','skipped_stale','rolled_back','released')),
  description_hu text,
  evidence jsonb,
  confidence numeric,
  reject_reason text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric,
  prev_values jsonb,
  applied_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_description_drafts_entity_idx ON public.entity_description_drafts (entity_kind, entity_id);
CREATE INDEX entity_description_drafts_job_idx ON public.entity_description_drafts (job_id, status);
GRANT ALL ON public.entity_description_drafts TO service_role;
REVOKE ALL ON public.entity_description_drafts FROM anon, authenticated;
ALTER TABLE public.entity_description_drafts ENABLE ROW LEVEL SECURITY;

-- Candidates + public sources (episode title, show, date, RSS card summary; never clean text or transcript).
-- Retries: an entity is re-offered only after failed/released drafts, at most 2 attempts.
CREATE OR REPLACE FUNCTION public.entity_description_sources_v1(_kind text, _limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE out jsonb;
BEGIN
  IF _limit IS NULL OR _limit < 1 OR _limit > 1000 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
  IF _kind = 'organization' THEN
    SELECT coalesce(jsonb_agg(q.x), '[]'::jsonb) INTO out FROM (
      SELECT jsonb_build_object('entity_id', o.id, 'name', o.name, 'org_type', o.org_type,
        'attempt', (SELECT count(*) FROM entity_description_drafts d WHERE d.entity_kind = 'organization' AND d.entity_id = o.id) + 1,
        'episodes', (
          SELECT coalesce(jsonb_agg(jsonb_build_object('i', e.rn, 'podcast', e.podcast, 'title', e.title, 'date', e.d, 'summary', e.summary) ORDER BY e.rn), '[]'::jsonb)
          FROM (
            SELECT row_number() OVER (ORDER BY c.published_at DESC NULLS LAST) AS rn, p.title AS podcast,
                   coalesce(nullif(btrim(c.display_title), ''), c.title) AS title, to_char(c.published_at, 'YYYY-MM-DD') AS d,
                   left(coalesce(c.card_summary, ''), 600) AS summary
            FROM (SELECT DISTINCT m.episode_id FROM episode_organization_map m WHERE m.organization_id = o.id) mm
            JOIN episode_cards c ON c.episode_id = mm.episode_id
            JOIN podcasts p ON p.id = c.podcast_id AND p.language ILIKE 'hu%'
            WHERE coalesce(btrim(c.title), '') <> ''
            ORDER BY c.published_at DESC NULLS LAST
            LIMIT 8) e)) AS x
      FROM organizations o
      WHERE o.is_indexable IS TRUE
        AND coalesce(btrim(o.ai_bio), '') = '' AND coalesce(btrim(o.wikipedia_extract), '') = '' AND coalesce(btrim(o.short_description_hu), '') = ''
        AND o.quality_hold_at IS NULL AND o.ai_duplicate_of_organization_id IS NULL
        AND coalesce(o.ai_review_status, '') NOT IN ('needs_human_review', 'duplicate_candidate')
        AND NOT EXISTS (SELECT 1 FROM entity_description_drafts d WHERE d.entity_kind = 'organization' AND d.entity_id = o.id AND d.status NOT IN ('failed', 'released'))
        AND (SELECT count(*) FROM entity_description_drafts d WHERE d.entity_kind = 'organization' AND d.entity_id = o.id) < 2
      ORDER BY o.gated_episode_count DESC NULLS LAST, o.id
      LIMIT _limit) q;
  ELSIF _kind = 'person' THEN
    SELECT coalesce(jsonb_agg(q.x), '[]'::jsonb) INTO out FROM (
      SELECT jsonb_build_object('entity_id', pe.id, 'name', pe.name,
        'attempt', (SELECT count(*) FROM entity_description_drafts d WHERE d.entity_kind = 'person' AND d.entity_id = pe.id) + 1,
        'episodes', (
          SELECT coalesce(jsonb_agg(jsonb_build_object('i', e.rn, 'podcast', e.podcast, 'title', e.title, 'date', e.d, 'summary', e.summary, 'role', e.role) ORDER BY e.rn), '[]'::jsonb)
          FROM (
            SELECT row_number() OVER (ORDER BY c.published_at DESC NULLS LAST) AS rn, p.title AS podcast,
                   coalesce(nullif(btrim(c.display_title), ''), c.title) AS title, to_char(c.published_at, 'YYYY-MM-DD') AS d,
                   left(coalesce(c.card_summary, ''), 600) AS summary, mm.role
            FROM (
              SELECT DISTINCT ON (m.episode_id) m.episode_id, coalesce(m.mention_type, 'mention') AS role
              FROM person_episode_mentions m
              WHERE m.person_id = pe.id AND m.relevance_status = 'accepted' AND person_link_trusted_v1(m.person_id, m.validation_source)
              ORDER BY m.episode_id, (m.mention_type = 'participant') DESC) mm
            JOIN episode_cards c ON c.episode_id = mm.episode_id
            JOIN podcasts p ON p.id = c.podcast_id AND p.language ILIKE 'hu%'
            WHERE coalesce(btrim(c.title), '') <> ''
            ORDER BY c.published_at DESC NULLS LAST
            LIMIT 8) e)) AS x
      FROM people pe
      WHERE pe.is_public IS TRUE AND pe.is_indexable IS TRUE
        AND coalesce(pe.ai_bio_status, '') <> 'published'
        AND coalesce(btrim(pe.wikipedia_extract), '') = '' AND coalesce(btrim(pe.short_description_hu), '') = ''
        AND NOT coalesce(pe.is_deceased, false) AND NOT coalesce(pe.is_historical, false) AND NOT coalesce(pe.is_topic_only, false)
        AND coalesce(pe.identity_status, 'normal') IN ('normal', 'confirmed', 'context_resolved')
        AND coalesce(pe.ai_review_status, '') NOT IN ('needs_human_review', 'duplicate_candidate')
        AND coalesce(pe.ai_recommended_action, '') NOT IN ('hide', 'reject')
        AND coalesce(pe.activation_status, '') NOT IN ('inactive', 'hidden', 'rejected')
        AND NOT (coalesce(pe.identity_ambiguous, false) AND NOT coalesce(pe.manual_approved, false))
        AND NOT EXISTS (SELECT 1 FROM entity_description_drafts d WHERE d.entity_kind = 'person' AND d.entity_id = pe.id AND d.status NOT IN ('failed', 'released'))
        AND (SELECT count(*) FROM entity_description_drafts d WHERE d.entity_kind = 'person' AND d.entity_id = pe.id) < 2
      ORDER BY pe.gated_episode_count DESC NULLS LAST, pe.id
      LIMIT _limit) q;
  ELSE
    RAISE EXCEPTION 'invalid_kind';
  END IF;
  RETURN out;
END;
$function$;

-- Atomic spend reservation against the owner caps stored in controls.
CREATE OR REPLACE FUNCTION public.reserve_entity_description_cost_v1(_job uuid, _amount numeric, _requests integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE ctrl jsonb; total_cap numeric; daily_cap numeric; committed numeric; today numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('entity_description_openai_cost', 0));
  SELECT value INTO ctrl FROM app_settings WHERE key = 'entity_description_openai_batch_controls';
  IF ctrl IS NULL OR COALESCE((ctrl->>'enabled')::boolean, false) IS NOT TRUE OR ctrl->'authorized' IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  total_cap := COALESCE((ctrl->>'total_cap_usd')::numeric, 0);
  daily_cap := LEAST(COALESCE((ctrl->>'daily_cap_usd')::numeric, 0), total_cap);
  IF _amount IS NULL OR _amount <= 0 OR _requests IS NULL OR _requests <= 0 THEN RAISE EXCEPTION 'invalid_reservation'; END IF;
  SELECT COALESCE(sum(GREATEST(reserved_cost_usd, COALESCE(actual_cost_usd, 0))), 0),
         COALESCE(sum(GREATEST(reserved_cost_usd, COALESCE(actual_cost_usd, 0))) FILTER (WHERE created_at >= date_trunc('day', now())), 0)
    INTO committed, today
  FROM entity_description_jobs WHERE status <> 'aborted' AND id <> _job;
  IF committed + _amount > total_cap THEN RAISE EXCEPTION 'total_cap_exceeded'; END IF;
  IF today + _amount > daily_cap THEN RAISE EXCEPTION 'daily_cap_exceeded'; END IF;
  UPDATE entity_description_jobs SET reserved_cost_usd = _amount, request_count = _requests, status = 'uploading', updated_at = now()
  WHERE id = _job AND status = 'claimed';
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_claimed'; END IF;
  RETURN jsonb_build_object('committed_usd', committed + _amount, 'today_usd', today + _amount, 'total_cap_usd', total_cap, 'daily_cap_usd', daily_cap);
END;
$function$;

-- Publish one verified organization draft: only onto still-empty description fields, with backup.
CREATE OR REPLACE FUNCTION public.apply_entity_description_draft_v1(_draft uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE d record; o record; v_model text;
BEGIN
  SELECT * INTO d FROM entity_description_drafts WHERE id = _draft FOR UPDATE;
  IF NOT FOUND OR d.status <> 'verified' OR coalesce(btrim(d.description_hu), '') = '' THEN RETURN 'not_verified'; END IF;
  IF d.entity_kind <> 'organization' THEN RETURN 'kind_requires_owner_review'; END IF;
  SELECT id, ai_bio, ai_bio_status, ai_bio_model, ai_bio_generated_at, ai_bio_confidence, wikipedia_extract, short_description_hu
    INTO o FROM organizations WHERE id = d.entity_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE entity_description_drafts SET status = 'skipped_stale', reject_reason = 'target_missing', updated_at = now() WHERE id = _draft;
    RETURN 'skipped_stale';
  END IF;
  IF coalesce(btrim(o.ai_bio), '') <> '' OR coalesce(btrim(o.wikipedia_extract), '') <> '' OR coalesce(btrim(o.short_description_hu), '') <> '' THEN
    UPDATE entity_description_drafts SET status = 'skipped_stale', reject_reason = 'target_changed', updated_at = now() WHERE id = _draft;
    RETURN 'skipped_stale';
  END IF;
  SELECT model INTO v_model FROM entity_description_jobs WHERE id = d.job_id;
  UPDATE entity_description_drafts SET status = 'applied', applied_at = now(), updated_at = now(),
    prev_values = jsonb_build_object('ai_bio', o.ai_bio, 'ai_bio_status', o.ai_bio_status, 'ai_bio_model', o.ai_bio_model,
      'ai_bio_generated_at', o.ai_bio_generated_at, 'ai_bio_confidence', o.ai_bio_confidence)
  WHERE id = _draft;
  UPDATE organizations SET ai_bio = d.description_hu, ai_bio_status = 'published', ai_bio_model = 'openai/' || coalesce(v_model, 'unknown'),
    ai_bio_generated_at = now(), ai_bio_confidence = d.confidence
  WHERE id = o.id;
  RETURN 'applied';
END;
$function$;

-- Undo a job: restore backups only where the published text is still ours.
CREATE OR REPLACE FUNCTION public.rollback_entity_description_job_v1(_job uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE d record; n integer := 0;
BEGIN
  FOR d IN SELECT * FROM entity_description_drafts WHERE job_id = _job AND status = 'applied' AND entity_kind = 'organization' FOR UPDATE LOOP
    UPDATE organizations SET ai_bio = d.prev_values->>'ai_bio',
      ai_bio_status = coalesce(d.prev_values->>'ai_bio_status', 'pending'),
      ai_bio_model = d.prev_values->>'ai_bio_model',
      ai_bio_generated_at = (d.prev_values->>'ai_bio_generated_at')::timestamptz,
      ai_bio_confidence = (d.prev_values->>'ai_bio_confidence')::numeric
    WHERE id = d.entity_id AND ai_bio IS NOT DISTINCT FROM d.description_hu;
    IF FOUND THEN
      n := n + 1;
      UPDATE entity_description_drafts SET status = 'rolled_back', rolled_back_at = now(), updated_at = now() WHERE id = d.id;
    END IF;
  END LOOP;
  UPDATE entity_description_jobs SET rolled_back_at = now(), updated_at = now() WHERE id = _job;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.entity_description_sources_v1(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_entity_description_cost_v1(uuid, numeric, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_entity_description_draft_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rollback_entity_description_job_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entity_description_sources_v1(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_entity_description_cost_v1(uuid, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_entity_description_draft_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rollback_entity_description_job_v1(uuid) TO service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.entity_description_sources_v1(text, integer) FROM readonly_codex';
    EXECUTE 'REVOKE ALL ON FUNCTION public.reserve_entity_description_cost_v1(uuid, numeric, integer) FROM readonly_codex';
    EXECUTE 'REVOKE ALL ON FUNCTION public.apply_entity_description_draft_v1(uuid) FROM readonly_codex';
    EXECUTE 'REVOKE ALL ON FUNCTION public.rollback_entity_description_job_v1(uuid) FROM readonly_codex';
  END IF;
END $$;

INSERT INTO public.app_settings (key, value)
VALUES ('entity_description_openai_batch_controls', jsonb_build_object(
  'enabled', true, 'model', 'gpt-6-luna', 'reasoning_effort', 'low', 'max_output_tokens', 900,
  'total_cap_usd', 2.5, 'daily_cap_usd', 2.5, 'org_job_size', 600, 'person_trial_limit', 200, 'max_open_jobs', 2,
  'auto_apply_kinds', jsonb_build_array('organization'),
  'authorized', jsonb_build_object('by', 'Máté David (chat 2026-10-29 20:15 UTC)', 'at', now(),
    'note', 'Szervezetleírások (kb. 1-2 USD) + 200-as személyleírás-próba olcsó GPT-vel; személyek csak tulajdonosi átnézés után publikusak')))
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.internal_job_tokens (job, token)
SELECT 'entity-description-openai-batch', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
WHERE NOT EXISTS (SELECT 1 FROM public.internal_job_tokens WHERE job = 'entity-description-openai-batch');

-- Hourly: OpenAI batches take up to 24h; the tick disables controls when no work is left and the job then unschedules itself.
SELECT cron.schedule('entity-description-openai-batch-tick', '17 * * * *', $cron$
DO $b$
BEGIN
  IF COALESCE((SELECT (value->>'enabled')::boolean FROM public.app_settings WHERE key='entity_description_openai_batch_controls'), false)
     OR EXISTS (SELECT 1 FROM public.entity_description_jobs WHERE ingested_at IS NULL AND openai_batch_id IS NOT NULL AND status NOT IN ('aborted','ingested')) THEN
    PERFORM net.http_post(
      url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/entity-description-openai-batch',
      headers := jsonb_build_object('Content-Type','application/json','x-internal-token',(SELECT token FROM public.internal_job_tokens WHERE job = 'entity-description-openai-batch')),
      body := '{"action":"tick","trigger":"cron"}'::jsonb, timeout_milliseconds := 150000);
  ELSE
    PERFORM cron.unschedule('entity-description-openai-batch-tick');
  END IF;
END $b$;
$cron$);