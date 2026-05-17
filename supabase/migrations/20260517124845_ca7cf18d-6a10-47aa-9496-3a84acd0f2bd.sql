
-- People activation & AI review system

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS distinct_podcast_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS host_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guest_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subject_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mentioned_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS activation_status text NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS activation_reason text,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ai_review_score numeric,
  ADD COLUMN IF NOT EXISTS ai_review_confidence numeric,
  ADD COLUMN IF NOT EXISTS ai_review_flags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_review_summary text,
  ADD COLUMN IF NOT EXISTS ai_recommended_action text,
  ADD COLUMN IF NOT EXISTS ai_recommended_canonical_name text,
  ADD COLUMN IF NOT EXISTS ai_recommended_slug text,
  ADD COLUMN IF NOT EXISTS ai_duplicate_of_person_id uuid,
  ADD COLUMN IF NOT EXISTS ai_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_review_model text,
  ADD COLUMN IF NOT EXISTS ai_review_sources jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_people_activation_status ON public.people(activation_status);
CREATE INDEX IF NOT EXISTS idx_people_ai_review_status ON public.people(ai_review_status);
CREATE INDEX IF NOT EXISTS idx_people_indexable_active ON public.people(is_indexable, activation_status);

CREATE TABLE IF NOT EXISTS public.person_ai_review_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  priority integer NOT NULL DEFAULT 100,
  attempt_count integer NOT NULL DEFAULT 0,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

ALTER TABLE public.person_ai_review_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pajr admin write" ON public.person_ai_review_jobs;
CREATE POLICY "pajr admin write" ON public.person_ai_review_jobs
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "pajr public read" ON public.person_ai_review_jobs;
CREATE POLICY "pajr public read" ON public.person_ai_review_jobs
  FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_pajr_status_priority ON public.person_ai_review_jobs(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_pajr_person ON public.person_ai_review_jobs(person_id);

-- Recompute activation status for all people, only counting HU-approved content.
CREATE OR REPLACE FUNCTION public.refresh_person_activation_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int := 0;
  v_inactive int := 0;
  v_noindex int := 0;
  v_indexable int := 0;
  v_downgraded_public int := 0;
  v_downgraded_index int := 0;
  v_prev_public int;
  v_prev_index int;
BEGIN
  SELECT count(*) FILTER (WHERE is_public), count(*) FILTER (WHERE is_indexable)
    INTO v_prev_public, v_prev_index
  FROM public.people;

  WITH agg AS (
    SELECT
      pem.person_id,
      count(*)::int                                                                     AS episode_count,
      count(*) FILTER (WHERE pem.mention_type IN ('host','guest','subject'))::int       AS strong_mention_count,
      count(*) FILTER (WHERE pem.mention_type = 'host')::int                            AS host_count,
      count(*) FILTER (WHERE pem.mention_type = 'guest')::int                           AS guest_count,
      count(*) FILTER (WHERE pem.mention_type = 'subject')::int                         AS subject_count,
      count(*) FILTER (WHERE pem.mention_type = 'mentioned')::int                       AS mentioned_count,
      count(DISTINCT pem.podcast_id)::int                                               AS distinct_podcast_count,
      max(e.published_at)                                                               AS latest_episode_at,
      avg(pem.confidence)::numeric                                                      AS avg_conf
    FROM public.person_episode_mentions pem
    JOIN public.episodes e ON e.id = pem.episode_id
    JOIN public.podcasts p ON p.id = pem.podcast_id
    WHERE p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
    GROUP BY pem.person_id
  )
  UPDATE public.people pe
  SET
    episode_count          = COALESCE(a.episode_count, 0),
    strong_mention_count   = COALESCE(a.strong_mention_count, 0),
    host_count             = COALESCE(a.host_count, 0),
    guest_count            = COALESCE(a.guest_count, 0),
    subject_count          = COALESCE(a.subject_count, 0),
    mentioned_count        = COALESCE(a.mentioned_count, 0),
    distinct_podcast_count = COALESCE(a.distinct_podcast_count, 0),
    podcast_count          = COALESCE(a.distinct_podcast_count, 0),
    latest_episode_at      = a.latest_episode_at,
    confidence             = COALESCE(a.avg_conf, 0)
  FROM agg a
  WHERE pe.id = a.person_id;

  -- people with no mentions: zero counts
  UPDATE public.people
  SET episode_count=0, strong_mention_count=0, host_count=0, guest_count=0,
      subject_count=0, mentioned_count=0, distinct_podcast_count=0, podcast_count=0,
      latest_episode_at=NULL, confidence=0
  WHERE id NOT IN (SELECT person_id FROM public.person_episode_mentions);

  -- Compute activation status per person.
  WITH calc AS (
    SELECT
      id, manual_approved, wikipedia_match_status,
      episode_count, strong_mention_count, host_count, guest_count, subject_count,
      mentioned_count, distinct_podcast_count, confidence,
      ai_review_status, ai_recommended_action,
      -- block flags
      (ai_review_status IN ('needs_human_review','duplicate_candidate')
        OR ai_recommended_action IN ('hide','reject','merge')) AS blocked
    FROM public.people
  ),
  decided AS (
    SELECT
      id,
      manual_approved,
      blocked,
      -- public eligibility
      CASE
        WHEN manual_approved THEN true
        WHEN (host_count>=1 AND episode_count>=3) THEN true
        WHEN (strong_mention_count>=2 AND (guest_count+subject_count)>=2) THEN true
        WHEN (wikipedia_match_status='verified' AND strong_mention_count>=1) THEN true
        WHEN (strong_mention_count=0 AND mentioned_count>=5 AND distinct_podcast_count>=2 AND confidence>=0.75) THEN true
        ELSE false
      END AS eligible_public,
      -- indexable eligibility
      CASE
        WHEN manual_approved THEN true
        WHEN (strong_mention_count>=3 AND distinct_podcast_count>=2) THEN true
        WHEN (host_count>=1 AND episode_count>=3 AND distinct_podcast_count>=1) THEN true
        WHEN (wikipedia_match_status='verified' AND strong_mention_count>=2) THEN true
        WHEN (strong_mention_count=0 AND mentioned_count>=8 AND distinct_podcast_count>=3 AND confidence>=0.80) THEN true
        ELSE false
      END AS eligible_indexable
    FROM calc
  )
  UPDATE public.people pe
  SET
    is_public = CASE WHEN d.blocked THEN false ELSE d.eligible_public END,
    is_indexable = CASE WHEN d.blocked THEN false WHEN d.eligible_indexable AND d.eligible_public THEN true ELSE false END,
    activation_status = CASE
      WHEN d.manual_approved THEN 'manual_approved'
      WHEN d.blocked THEN 'inactive'
      WHEN d.eligible_indexable AND d.eligible_public THEN 'indexable'
      WHEN d.eligible_public THEN 'public_noindex'
      ELSE 'inactive'
    END,
    activation_reason = CASE
      WHEN d.manual_approved THEN 'manual_approved'
      WHEN d.blocked THEN 'blocked_by_ai_review_or_recommendation'
      WHEN d.eligible_indexable THEN 'meets_indexable_threshold'
      WHEN d.eligible_public THEN 'meets_public_threshold_only'
      ELSE 'below_activation_thresholds'
    END,
    activated_at = CASE
      WHEN (d.eligible_public OR d.manual_approved) AND pe.activated_at IS NULL THEN now()
      WHEN NOT (d.eligible_public OR d.manual_approved) THEN NULL
      ELSE pe.activated_at
    END
  FROM decided d
  WHERE pe.id = d.id;

  SELECT count(*), count(*) FILTER (WHERE activation_status='inactive'),
         count(*) FILTER (WHERE activation_status='public_noindex'),
         count(*) FILTER (WHERE activation_status IN ('indexable','manual_approved'))
    INTO v_total, v_inactive, v_noindex, v_indexable
  FROM public.people;

  v_downgraded_public := GREATEST(0, v_prev_public - (SELECT count(*) FROM public.people WHERE is_public));
  v_downgraded_index  := GREATEST(0, v_prev_index  - (SELECT count(*) FROM public.people WHERE is_indexable));

  RETURN jsonb_build_object(
    'total', v_total,
    'inactive', v_inactive,
    'public_noindex', v_noindex,
    'indexable', v_indexable,
    'prev_public', v_prev_public,
    'prev_indexable', v_prev_index,
    'downgraded_from_public', v_downgraded_public,
    'downgraded_from_indexable', v_downgraded_index,
    'now_public', (SELECT count(*) FROM public.people WHERE is_public),
    'now_indexable', (SELECT count(*) FROM public.people WHERE is_indexable)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_person_activation_status() TO anon, authenticated, service_role;

-- Convenience views
CREATE OR REPLACE VIEW public.person_activation_status_view AS
SELECT id, slug, name, activation_status, activation_reason, is_public, is_indexable,
       episode_count, strong_mention_count, distinct_podcast_count, host_count,
       guest_count, subject_count, mentioned_count, confidence, latest_episode_at,
       wikipedia_match_status, ai_review_status, ai_recommended_action
FROM public.people;

CREATE OR REPLACE VIEW public.person_ai_review_summary_view AS
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE ai_review_status='pending') AS pending,
  count(*) FILTER (WHERE ai_review_status='reviewed') AS reviewed,
  count(*) FILTER (WHERE ai_review_status='needs_human_review') AS needs_human_review,
  count(*) FILTER (WHERE ai_review_status='duplicate_candidate') AS duplicate_candidates,
  count(*) FILTER (WHERE ai_recommended_action='hide') AS recommended_hide,
  count(*) FILTER (WHERE ai_recommended_action='keep_public_noindex') AS recommended_noindex,
  count(*) FILTER (WHERE ai_recommended_action='keep_indexable') AS recommended_keep_indexable,
  count(*) FILTER (WHERE ai_recommended_action='reject') AS recommended_reject,
  count(*) FILTER (WHERE ai_recommended_action='merge') AS recommended_merge,
  count(*) FILTER (WHERE ai_recommended_action='needs_review') AS recommended_needs_review
FROM public.people;

CREATE OR REPLACE VIEW public.person_ai_duplicate_candidates_view AS
SELECT id, slug, name, ai_duplicate_of_person_id, ai_review_summary, ai_review_confidence
FROM public.people
WHERE ai_recommended_action='merge' OR ai_review_status='duplicate_candidate';

CREATE OR REPLACE VIEW public.person_ai_action_queue_view AS
SELECT id, slug, name, activation_status, ai_review_status, ai_recommended_action,
       ai_review_confidence, ai_review_flags, ai_review_summary, episode_count,
       strong_mention_count, distinct_podcast_count
FROM public.people
WHERE ai_review_status='reviewed'
  AND ai_recommended_action IS NOT NULL
ORDER BY ai_reviewed_at DESC NULLS LAST;
