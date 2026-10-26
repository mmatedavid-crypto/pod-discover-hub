-- Organization quality hold v2 (entity quality autopilot).
-- A reversible, audited "quality hold" keeps ambiguous / non-entity organizations out of
-- search indexing and the hub lists. Pages, chips and episode links stay. A hold needs two
-- opinions: the cheap reviewer marked it negative AND the second opinion (Astra) did not
-- confidently confirm it as real. recompute_org_gated_counts respects the hold, so it no
-- longer gets silently undone on the next recount.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS quality_hold_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_hold_reason text,
  ADD COLUMN IF NOT EXISTS quality_hold_released_at timestamptz;

COMMENT ON COLUMN public.organizations.quality_hold_at IS 'Set by apply_org_quality_holds_v1: kept out of indexing/hub lists until released.';
COMMENT ON COLUMN public.organizations.quality_hold_released_at IS 'Hold was released (owner or confident second opinion); never re-held automatically.';

CREATE TABLE IF NOT EXISTS public.organization_quality_hold_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('hold', 'release')),
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_quality_hold_log_org_idx
  ON public.organization_quality_hold_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS organization_quality_hold_log_run_idx
  ON public.organization_quality_hold_log (run_id) WHERE run_id IS NOT NULL;

GRANT SELECT ON public.organization_quality_hold_log TO authenticated;
GRANT ALL ON public.organization_quality_hold_log TO service_role;
ALTER TABLE public.organization_quality_hold_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read organization quality holds" ON public.organization_quality_hold_log;
CREATE POLICY "Admins read organization quality holds" ON public.organization_quality_hold_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Pure decision rule: 'hold' or 'skip:<reason>'.
CREATE OR REPLACE FUNCTION public.org_quality_hold_verdict_v1(
  _review_status text, _score numeric, _summary text, _org_type text, _manually_seeded boolean,
  _wiki_status text, _internal boolean, _released_at timestamptz, _astra jsonb
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _released_at IS NOT NULL THEN 'skip:released'
    WHEN _review_status IS DISTINCT FROM 'reviewed' THEN 'skip:not_reviewed'
    WHEN NOT (COALESCE(_score, 1) <= 0.2
      OR COALESCE(_summary, '') ~* '(nem (egy )?(valódi|konkrét) szervezet|túl (rövid|általános)|elrejtésre javasolt|nem szervezet|téves kinyerés|nem azonosítható)')
      THEN 'skip:review_not_negative'
    WHEN _org_type = 'party' OR COALESCE(_manually_seeded, false) OR _wiki_status = 'verified' THEN 'skip:protected'
    WHEN COALESCE(_internal, false) THEN 'skip:internal'
    WHEN _astra IS NULL OR COALESCE(_astra->>'verdict', '') = '' THEN 'skip:awaiting_second_opinion'
    WHEN _astra->>'verdict' IN ('not_real_entity', 'wrong_type') THEN 'hold'
    WHEN _astra->>'verdict' = 'ok' AND
      (CASE WHEN (_astra->>'confidence') ~ '^[0-9]*\.?[0-9]+$' THEN (_astra->>'confidence')::numeric ELSE 0 END) < 0.9
      THEN 'hold'
    WHEN _astra->>'verdict' = 'ok' THEN 'skip:second_opinion_confirms_real'
    ELSE 'skip:second_opinion_other'
  END
$$;

-- Internal: release one hold, restoring the flags recorded when it was placed.
CREATE OR REPLACE FUNCTION public.release_org_quality_hold_internal_v1(_org_id uuid, _reason text, _run_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_now jsonb;
BEGIN
  SELECT jsonb_build_object('is_indexable', o.is_indexable, 'is_browsable_in_hub', o.is_browsable_in_hub,
           'browsable_reason', o.browsable_reason, 'quality_hold_at', o.quality_hold_at)
    INTO v_now
    FROM public.organizations o WHERE o.id = _org_id AND o.quality_hold_at IS NOT NULL FOR UPDATE;
  IF v_now IS NULL THEN RETURN false; END IF;

  SELECT l.before_state INTO v_before
    FROM public.organization_quality_hold_log l
   WHERE l.organization_id = _org_id AND l.action = 'hold'
   ORDER BY l.created_at DESC, l.id DESC LIMIT 1;

  UPDATE public.organizations o SET
    quality_hold_at = NULL,
    quality_hold_reason = NULL,
    quality_hold_released_at = now(),
    is_indexable = COALESCE((v_before->>'is_indexable')::boolean, o.is_indexable),
    is_browsable_in_hub = COALESCE((v_before->>'is_browsable_in_hub')::boolean, o.is_browsable_in_hub),
    browsable_reason = COALESCE(v_before->>'browsable_reason', o.browsable_reason),
    updated_at = now()
  WHERE o.id = _org_id AND o.quality_hold_at IS NOT NULL;

  INSERT INTO public.organization_quality_hold_log (organization_id, action, reason, evidence, before_state, run_id)
  VALUES (_org_id, 'release', COALESCE(_reason, 'release'), jsonb_build_object('restored', v_before), v_now, _run_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_org_quality_holds_v1(
  _limit integer DEFAULT 100, _dry_run boolean DEFAULT false, _run_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(_limit, 100), 500));
  v_held integer := 0;
  v_released integer := 0;
  v_skips jsonb;
  v_sample text[] := '{}';
  v_released_names text[] := '{}';
  v_reason text;
  r record;
BEGIN
  -- 1) A confident second opinion that arrived after the hold releases it.
  FOR r IN
    SELECT o.id, o.name FROM public.organizations o
     WHERE o.quality_hold_at IS NOT NULL
       AND o.astra_reviewed_at > o.quality_hold_at
       AND o.astra_verdict->>'verdict' = 'ok'
       AND (CASE WHEN (o.astra_verdict->>'confidence') ~ '^[0-9]*\.?[0-9]+$'
                 THEN (o.astra_verdict->>'confidence')::numeric ELSE 0 END) >= 0.9
     ORDER BY o.id LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    IF _dry_run THEN
      v_released := v_released + 1;
    ELSIF public.release_org_quality_hold_internal_v1(r.id, 'second_opinion_confirms_real', _run_id) THEN
      v_released := v_released + 1;
    END IF;
    IF array_length(v_released_names, 1) IS NULL OR array_length(v_released_names, 1) < 10 THEN
      v_released_names := v_released_names || r.name;
    END IF;
  END LOOP;

  -- 2) Place new holds (CAS on quality_hold_at IS NULL, before-state logged for rollback).
  FOR r IN
    SELECT o.id, o.name, o.is_indexable, o.is_browsable_in_hub, o.browsable_reason,
           o.ai_review_score, o.ai_recommended_action, o.ai_review_summary, o.astra_verdict
      FROM public.organizations o
     WHERE o.quality_hold_at IS NULL
       AND (o.is_indexable OR o.is_browsable_in_hub)
       AND public.org_quality_hold_verdict_v1(o.ai_review_status, o.ai_review_score, o.ai_review_summary, o.org_type,
             o.manually_seeded, o.wikipedia_match_status, o.is_podcast_internal, o.quality_hold_released_at, o.astra_verdict) = 'hold'
     ORDER BY o.gated_episode_count DESC NULLS LAST, o.id
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    v_reason := CASE WHEN r.astra_verdict->>'verdict' = 'ok' THEN 'ambiguous_name' ELSE r.astra_verdict->>'verdict' END;
    IF NOT _dry_run THEN
      UPDATE public.organizations o SET
        quality_hold_at = now(), quality_hold_reason = v_reason,
        is_indexable = false, is_browsable_in_hub = false, browsable_reason = 'quality_hold', updated_at = now()
      WHERE o.id = r.id AND o.quality_hold_at IS NULL;
      IF NOT FOUND THEN CONTINUE; END IF;
      INSERT INTO public.organization_quality_hold_log (organization_id, action, reason, evidence, before_state, run_id)
      VALUES (r.id, 'hold', v_reason,
        jsonb_build_object(
          'reviewer_score', r.ai_review_score, 'reviewer_action', r.ai_recommended_action,
          'reviewer_summary', left(COALESCE(r.ai_review_summary, ''), 240),
          'second_opinion', r.astra_verdict->>'verdict',
          'second_opinion_confidence', r.astra_verdict->'confidence',
          'second_opinion_reason', left(COALESCE(r.astra_verdict->>'reason', ''), 240)),
        jsonb_build_object('is_indexable', r.is_indexable, 'is_browsable_in_hub', r.is_browsable_in_hub,
          'browsable_reason', r.browsable_reason),
        _run_id);
    END IF;
    v_held := v_held + 1;
    IF array_length(v_sample, 1) IS NULL OR array_length(v_sample, 1) < 15 THEN v_sample := v_sample || r.name; END IF;
  END LOOP;

  -- 3) What is left, by reason (negatively reviewed, still listed, not held).
  SELECT COALESCE(jsonb_object_agg(k, n), '{}'::jsonb) INTO v_skips FROM (
    SELECT public.org_quality_hold_verdict_v1(o.ai_review_status, o.ai_review_score, o.ai_review_summary, o.org_type,
             o.manually_seeded, o.wikipedia_match_status, o.is_podcast_internal, o.quality_hold_released_at, o.astra_verdict) AS k,
           count(*) AS n
      FROM public.organizations o
     WHERE o.quality_hold_at IS NULL AND o.ai_review_status = 'reviewed' AND (o.is_indexable OR o.is_browsable_in_hub)
     GROUP BY 1
  ) s WHERE k NOT IN ('skip:review_not_negative');

  RETURN jsonb_build_object(
    'dry_run', _dry_run, 'held', v_held, 'released', v_released,
    'held_sample', to_jsonb(v_sample), 'released_sample', to_jsonb(v_released_names),
    'remaining', v_skips,
    'total_on_hold', (SELECT count(*) FROM public.organizations WHERE quality_hold_at IS NOT NULL)
  );
END;
$$;

-- Owner rollback: release by organization ids and/or by the run that placed the holds.
CREATE OR REPLACE FUNCTION public.release_org_quality_holds_v1(
  _org_ids uuid[] DEFAULT NULL, _hold_run_id uuid DEFAULT NULL, _reason text DEFAULT 'owner_release'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
  v_id uuid;
BEGIN
  IF _org_ids IS NULL AND _hold_run_id IS NULL THEN
    RAISE EXCEPTION 'release_org_quality_holds_v1: pass _org_ids or _hold_run_id';
  END IF;
  FOR v_id IN
    SELECT DISTINCT x FROM (
      SELECT unnest(COALESCE(_org_ids, '{}'::uuid[])) AS x
      UNION
      SELECT l.organization_id FROM public.organization_quality_hold_log l
       WHERE _hold_run_id IS NOT NULL AND l.run_id = _hold_run_id AND l.action = 'hold'
    ) ids
  LOOP
    IF public.release_org_quality_hold_internal_v1(v_id, _reason, NULL) THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('released', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.org_quality_hold_verdict_v1(text, numeric, text, text, boolean, text, boolean, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_org_quality_hold_internal_v1(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_org_quality_holds_v1(integer, boolean, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_org_quality_holds_v1(uuid[], uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_quality_hold_verdict_v1(text, numeric, text, text, boolean, text, boolean, timestamptz, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_org_quality_hold_internal_v1(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_org_quality_holds_v1(integer, boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_org_quality_holds_v1(uuid[], uuid, text) TO service_role;

-- Recount respects the hold (otherwise the next recount re-lists held organizations).
CREATE OR REPLACE FUNCTION public.recompute_org_gated_counts()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_radio_whitelist text[] := ARRAY[
    'Tilos Rádió','Kossuth Rádió','Klubrádió','InfoRádió','Szabad Európa Rádió',
    'Petőfi Rádió','Bartók Rádió','Katolikus Rádió','Magyar Rádió'
  ];
BEGIN
  WITH counts AS (
    SELECT
      m.organization_id,
      COUNT(DISTINCT m.episode_id) FILTER (WHERE p.language_decision = 'accept_hungarian' AND c.episode_id IS NOT NULL) AS gated_eps,
      COUNT(DISTINCT COALESCE(m.podcast_id, e.podcast_id)) FILTER (WHERE p.language_decision = 'accept_hungarian' AND c.episode_id IS NOT NULL) AS gated_pods,
      COUNT(DISTINCT m.episode_id) AS total_eps,
      COUNT(DISTINCT COALESCE(m.podcast_id, e.podcast_id)) AS total_pods,
      COUNT(*) FILTER (WHERE m.role = 'mentioned') AS mentions,
      COUNT(*) FILTER (WHERE m.role = 'primary') AS primaries,
      MAX(c.published_at) FILTER (WHERE p.language_decision = 'accept_hungarian') AS latest_ep,
      array_agg(DISTINCT COALESCE(m.podcast_id, e.podcast_id)) AS source_pids
    FROM public.episode_organization_map m
    JOIN public.episodes e ON e.id = m.episode_id
    LEFT JOIN public.episode_cards c ON c.episode_id = m.episode_id
    LEFT JOIN public.podcasts p ON p.id = COALESCE(m.podcast_id, e.podcast_id)
    GROUP BY m.organization_id
  ),
  j AS (
    SELECT o2.id, c.* FROM public.organizations o2 LEFT JOIN counts c ON c.organization_id = o2.id
  )
  UPDATE public.organizations o
  SET
    episode_count = COALESCE(j.total_eps, 0),
    gated_episode_count = COALESCE(j.gated_eps, 0),
    podcast_count = COALESCE(j.total_pods, 0),
    gated_podcast_count = COALESCE(j.gated_pods, 0),
    distinct_podcast_count = COALESCE(array_length(j.source_pids, 1), 0),
    source_podcast_ids = COALESCE(j.source_pids, '{}'::uuid[]),
    mention_count = COALESCE(j.mentions, 0),
    primary_count = COALESCE(j.primaries, 0),
    latest_episode_at = j.latest_ep,
    is_public = CASE
      WHEN o.is_podcast_internal THEN false
      WHEN o.org_type = 'radio_station' AND NOT (o.name = ANY (v_radio_whitelist)) THEN false
      WHEN COALESCE(j.gated_eps, 0) >= 1 OR o.manually_seeded OR o.org_type = 'party' THEN true
      ELSE false END,
    is_indexable = CASE
      WHEN o.is_podcast_internal THEN false
      WHEN o.org_type = 'radio_station' AND NOT (o.name = ANY (v_radio_whitelist)) THEN false
      WHEN o.quality_hold_at IS NOT NULL THEN false
      WHEN o.org_type = 'party' AND COALESCE(j.gated_eps, 0) >= 1 THEN true
      WHEN o.wikipedia_match_status = 'verified' AND COALESCE(j.gated_eps, 0) >= 1 THEN true
      WHEN COALESCE(j.gated_eps, 0) >= 3 THEN true
      ELSE false END,
    is_browsable_in_hub = CASE
      WHEN o.is_podcast_internal THEN false
      WHEN o.org_type = 'radio_station' AND NOT (o.name = ANY (v_radio_whitelist)) THEN false
      WHEN o.quality_hold_at IS NOT NULL THEN false
      WHEN o.org_type = 'party' AND COALESCE(j.gated_eps, 0) >= 1 THEN true
      WHEN o.wikipedia_match_status = 'verified' AND COALESCE(j.gated_eps, 0) >= 1 THEN true
      WHEN COALESCE(j.gated_eps, 0) >= 3 THEN true
      ELSE false END,
    browsable_reason = CASE
      WHEN o.is_podcast_internal THEN 'podcast_internal'
      WHEN o.org_type = 'radio_station' AND NOT (o.name = ANY (v_radio_whitelist)) THEN 'radio_publisher_noise'
      WHEN o.quality_hold_at IS NOT NULL THEN 'quality_hold'
      WHEN o.org_type = 'party' AND COALESCE(j.gated_eps, 0) >= 1 THEN 'party_priority'
      WHEN o.wikipedia_match_status = 'verified' AND COALESCE(j.gated_eps, 0) >= 1 THEN 'wikipedia_verified'
      WHEN COALESCE(j.gated_eps, 0) >= 3 THEN 'has_hu_episodes'
      WHEN COALESCE(j.gated_eps, 0) >= 1 THEN 'public_low_ep'
      WHEN o.manually_seeded THEN 'editorial_seed'
      ELSE 'no_eps' END,
    updated_at = now()
  FROM j
  WHERE o.id = j.id
    AND (o.gated_episode_count IS DISTINCT FROM COALESCE(j.gated_eps,0)
      OR o.episode_count IS DISTINCT FROM COALESCE(j.total_eps,0)
      OR o.latest_episode_at IS DISTINCT FROM j.latest_ep
      OR o.is_public IS DISTINCT FROM (NOT o.is_podcast_internal AND NOT (o.org_type='radio_station' AND NOT (o.name = ANY (v_radio_whitelist))) AND (COALESCE(j.gated_eps,0) >= 1 OR o.manually_seeded OR o.org_type='party'))
      OR o.is_indexable OR o.is_browsable_in_hub);
END;
$function$;

COMMENT ON FUNCTION public.get_entity_quality_snapshot_v1(integer) IS 'DEPRECATED: entity-quality-autopilot no longer stores snapshots; holds go through apply_org_quality_holds_v1.';
