
-- people: ranking + disambiguation
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS people_hub_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recent_relevant_episode_count_30d integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS latest_accepted_relevant_episode_at timestamptz,
  ADD COLUMN IF NOT EXISTS one_show_host boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disambiguation_label text,
  ADD COLUMN IF NOT EXISTS disambiguation_context text,
  ADD COLUMN IF NOT EXISTS canonical_identity_key text,
  ADD COLUMN IF NOT EXISTS identity_confidence numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT 'normal';

-- mention relevance validation
ALTER TABLE public.person_episode_mentions
  ADD COLUMN IF NOT EXISTS relevance_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS final_relevance_score numeric,
  ADD COLUMN IF NOT EXISTS validation_source text,
  ADD COLUMN IF NOT EXISTS ai_identity_match text,
  ADD COLUMN IF NOT EXISTS ai_reason text,
  ADD COLUMN IF NOT EXISTS ai_evidence_phrases text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS ai_judged_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_model text;

CREATE INDEX IF NOT EXISTS idx_people_hub_score
  ON public.people (is_browsable_in_people_hub, people_hub_score DESC);

CREATE INDEX IF NOT EXISTS idx_pem_person_relevance
  ON public.person_episode_mentions (person_id, relevance_status);

CREATE INDEX IF NOT EXISTS idx_pem_relevance_status
  ON public.person_episode_mentions (relevance_status);

-- recompute hub score + browsability for all people
CREATE OR REPLACE FUNCTION public.refresh_people_hub_score()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_browsable_before int;
  v_browsable_after int;
  v_one_show_hidden int;
BEGIN
  SELECT count(*) INTO v_browsable_before FROM public.people WHERE is_browsable_in_people_hub = true;

  -- recompute per-person aggregates from accepted mentions on HU-approved podcasts
  WITH agg AS (
    SELECT
      p.id AS person_id,
      COUNT(*) FILTER (
        WHERE m.relevance_status = 'accepted'
          AND e.published_at >= now() - interval '30 days'
      ) AS recent_30d,
      MAX(e.published_at) FILTER (WHERE m.relevance_status = 'accepted') AS latest_at
    FROM public.people p
    LEFT JOIN public.person_episode_mentions m ON m.person_id = p.id
    LEFT JOIN public.episodes e ON e.id = m.episode_id
    LEFT JOIN public.podcasts pc ON pc.id = e.podcast_id
      AND pc.is_hungarian = true AND pc.language_decision = 'accept_hungarian'
    GROUP BY p.id
  )
  UPDATE public.people p
  SET
    recent_relevant_episode_count_30d = COALESCE(a.recent_30d, 0),
    latest_accepted_relevant_episode_at = a.latest_at,
    one_show_host = (COALESCE(p.distinct_podcast_count,0) = 1 AND COALESCE(p.host_count,0) >= 1)
  FROM agg a
  WHERE a.person_id = p.id;

  -- compute score
  UPDATE public.people p
  SET people_hub_score =
    GREATEST(0,
      3.0 * COALESCE(p.recent_relevant_episode_count_30d,0)
    + 2.5 * COALESCE(p.distinct_podcast_count,0)
    + 1.5 * COALESCE(p.strong_mention_count,0)
    + 1.0 * CASE WHEN p.wikipedia_match_status = 'verified' THEN 1 ELSE 0 END
    + 0.5 * CASE WHEN p.editorial_priority THEN COALESCE(p.editorial_priority_level,0)/100.0 ELSE 0 END
    + 0.1 * COALESCE(p.episode_count,0)
    - 5.0 * CASE WHEN p.one_show_host THEN 1 ELSE 0 END
    - 4.0 * CASE WHEN p.identity_status IN ('ambiguous','split_needed','needs_review') THEN 1 ELSE 0 END
    - 3.0 * CASE WHEN p.ai_review_status = 'duplicate_candidate' THEN 1 ELSE 0 END
    );

  -- recompute browsability
  UPDATE public.people p
  SET is_browsable_in_people_hub = (
    p.is_public = true
    AND p.activation_status IN ('indexable','public_noindex','manual_approved')
    AND p.ai_review_status NOT IN ('needs_human_review','duplicate_candidate')
    AND p.identity_status NOT IN ('ambiguous','split_needed','needs_review')
    AND (
      -- not a one-show host, OR explicitly approved/editorial with cross-podcast evidence
      p.one_show_host = false
      OR p.manual_approval_status = 'approved_browsable'
      OR (p.editorial_priority = true AND COALESCE(p.distinct_podcast_count,0) >= 2)
    )
    AND (
      p.recent_relevant_episode_count_30d > 0
      OR COALESCE(p.strong_mention_count,0) >= 2
      OR p.manual_approval_status = 'approved_browsable'
      OR p.editorial_priority = true
    )
  );

  SELECT count(*) INTO v_browsable_after FROM public.people WHERE is_browsable_in_people_hub = true;
  SELECT count(*) INTO v_one_show_hidden FROM public.people WHERE one_show_host = true AND is_browsable_in_people_hub = false;

  RETURN jsonb_build_object(
    'browsable_before', v_browsable_before,
    'browsable_after', v_browsable_after,
    'one_show_hidden', v_one_show_hidden
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_people_hub_score() TO authenticated, service_role;
