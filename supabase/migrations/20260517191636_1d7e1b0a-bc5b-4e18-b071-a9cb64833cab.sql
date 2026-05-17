
-- People editorial quality layer: browsable hub flag, editorial priority, seed table, missing content view

-- 1) people new columns
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS is_browsable_in_people_hub boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS browsable_reason text,
  ADD COLUMN IF NOT EXISTS editorial_priority boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS editorial_priority_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS editorial_notes text,
  ADD COLUMN IF NOT EXISTS manually_seeded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_approval_status text NOT NULL DEFAULT 'none';

CREATE INDEX IF NOT EXISTS idx_people_browsable ON public.people(is_browsable_in_people_hub) WHERE is_browsable_in_people_hub;
CREATE INDEX IF NOT EXISTS idx_people_editorial_priority ON public.people(editorial_priority) WHERE editorial_priority;

-- 2) editorial_people_seed (admin-only access)
CREATE TABLE IF NOT EXISTS public.editorial_people_seed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  canonical_name text,
  slug text,
  aliases text[] NOT NULL DEFAULT '{}',
  context_hints text[] NOT NULL DEFAULT '{}',
  priority_level integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'active',
  matched_person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.editorial_people_seed ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editorial_seed admin all" ON public.editorial_people_seed;
CREATE POLICY "editorial_seed admin all" ON public.editorial_people_seed
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
-- No public read policy: only admins (and service role bypassing RLS) can see this.

CREATE UNIQUE INDEX IF NOT EXISTS idx_editorial_seed_name ON public.editorial_people_seed (lower(name));
CREATE INDEX IF NOT EXISTS idx_editorial_seed_status ON public.editorial_people_seed (status);

-- 3) app_settings person_pages images flag
INSERT INTO public.app_settings(key, value, updated_at)
VALUES ('person_pages', '{"images_enabled": false}'::jsonb, now())
ON CONFLICT (key) DO UPDATE
  SET value = COALESCE(public.app_settings.value, '{}'::jsonb) || '{"images_enabled": false}'::jsonb,
      updated_at = now();

-- 4) refresh_person_activation_status: extend to also compute is_browsable_in_people_hub + browsable_reason
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
  v_browsable int := 0;
  v_one_pod_hidden int := 0;
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

  UPDATE public.people
  SET episode_count=0, strong_mention_count=0, host_count=0, guest_count=0,
      subject_count=0, mentioned_count=0, distinct_podcast_count=0, podcast_count=0,
      latest_episode_at=NULL, confidence=0
  WHERE id NOT IN (SELECT person_id FROM public.person_episode_mentions);

  -- activation_status + browsable hub flag
  WITH calc AS (
    SELECT
      id, manual_approved, wikipedia_match_status,
      episode_count, strong_mention_count, host_count, guest_count, subject_count,
      mentioned_count, distinct_podcast_count, confidence,
      ai_review_status, ai_recommended_action,
      editorial_priority, manual_approval_status,
      (ai_review_status IN ('needs_human_review','duplicate_candidate')
        OR ai_recommended_action IN ('hide','reject','merge')) AS blocked
    FROM public.people
  ),
  decided AS (
    SELECT
      id, manual_approved, blocked, editorial_priority, manual_approval_status,
      strong_mention_count, host_count, episode_count, distinct_podcast_count, wikipedia_match_status,
      CASE
        WHEN manual_approved THEN true
        WHEN (host_count>=1 AND episode_count>=3) THEN true
        WHEN (strong_mention_count>=2 AND (guest_count+subject_count)>=2) THEN true
        WHEN (wikipedia_match_status='verified' AND strong_mention_count>=1) THEN true
        WHEN (strong_mention_count=0 AND mentioned_count>=5 AND distinct_podcast_count>=2 AND confidence>=0.75) THEN true
        ELSE false
      END AS eligible_public,
      CASE
        WHEN manual_approved THEN true
        WHEN (strong_mention_count>=3 AND distinct_podcast_count>=2) THEN true
        WHEN (host_count>=1 AND episode_count>=3 AND distinct_podcast_count>=1) THEN true
        WHEN (wikipedia_match_status='verified' AND strong_mention_count>=2) THEN true
        WHEN (strong_mention_count=0 AND mentioned_count>=8 AND distinct_podcast_count>=3 AND confidence>=0.80) THEN true
        ELSE false
      END AS eligible_indexable
    FROM calc
  ),
  browsable AS (
    SELECT
      id,
      manual_approved, blocked, eligible_public, eligible_indexable,
      CASE
        WHEN blocked THEN false
        -- D) explicit manual/editorial approval
        WHEN manual_approval_status = 'approved_browsable' THEN true
        WHEN manual_approval_status = 'rejected' THEN false
        WHEN editorial_priority AND eligible_public THEN true
        -- A) multi-podcast relevance
        WHEN distinct_podcast_count >= 2 AND strong_mention_count >= 2 THEN true
        -- B) strong public figure
        WHEN wikipedia_match_status = 'verified' AND strong_mention_count >= 1 THEN true
        -- C) important host (manual approved or editorial priority)
        WHEN host_count >= 1 AND episode_count >= 5 AND (manual_approved OR editorial_priority) THEN true
        ELSE false
      END AS browsable_flag,
      CASE
        WHEN blocked THEN 'blocked'
        WHEN manual_approval_status = 'approved_browsable' THEN 'manual_approved_browsable'
        WHEN editorial_priority AND eligible_public THEN 'editorial_priority'
        WHEN distinct_podcast_count >= 2 AND strong_mention_count >= 2 THEN 'multi_podcast_relevance'
        WHEN wikipedia_match_status = 'verified' AND strong_mention_count >= 1 THEN 'verified_wikipedia'
        WHEN host_count >= 1 AND episode_count >= 5 AND (manual_approved OR editorial_priority) THEN 'important_host'
        WHEN distinct_podcast_count <= 1 THEN 'single_podcast_only'
        ELSE 'below_browsable_thresholds'
      END AS browsable_reason
    FROM decided
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
    is_browsable_in_people_hub = b.browsable_flag,
    browsable_reason = b.browsable_reason,
    activated_at = CASE
      WHEN (d.eligible_public OR d.manual_approved) AND pe.activated_at IS NULL THEN now()
      WHEN NOT (d.eligible_public OR d.manual_approved) THEN NULL
      ELSE pe.activated_at
    END
  FROM decided d
  JOIN browsable b ON b.id = d.id
  WHERE pe.id = d.id;

  SELECT count(*), count(*) FILTER (WHERE activation_status='inactive'),
         count(*) FILTER (WHERE activation_status='public_noindex'),
         count(*) FILTER (WHERE activation_status IN ('indexable','manual_approved')),
         count(*) FILTER (WHERE is_browsable_in_people_hub),
         count(*) FILTER (WHERE is_indexable AND NOT is_browsable_in_people_hub AND distinct_podcast_count<=1)
    INTO v_total, v_inactive, v_noindex, v_indexable, v_browsable, v_one_pod_hidden
  FROM public.people;

  RETURN jsonb_build_object(
    'total', v_total,
    'inactive', v_inactive,
    'public_noindex', v_noindex,
    'indexable', v_indexable,
    'browsable_in_hub', v_browsable,
    'one_pod_only_hidden_from_hub', v_one_pod_hidden,
    'prev_public', v_prev_public,
    'prev_indexable', v_prev_index,
    'now_public', (SELECT count(*) FROM public.people WHERE is_public),
    'now_indexable', (SELECT count(*) FROM public.people WHERE is_indexable)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_person_activation_status() TO anon, authenticated, service_role;

-- 5) person_missing_content_review_view (admin-only access via SECURITY DEFINER RPC wrapper)
DROP VIEW IF EXISTS public.person_missing_content_review_view CASCADE;
CREATE VIEW public.person_missing_content_review_view AS
SELECT
  p.id AS person_id,
  p.name,
  p.slug,
  p.is_public,
  p.is_indexable,
  p.is_browsable_in_people_hub,
  p.activation_status,
  p.episode_count,
  p.distinct_podcast_count,
  p.strong_mention_count,
  p.host_count,
  p.guest_count,
  p.subject_count,
  p.mentioned_count,
  p.wikipedia_match_status,
  p.ai_bio_status,
  (p.ai_bio IS NOT NULL AND length(trim(p.ai_bio)) > 0) AS has_ai_bio,
  (p.overview_text IS NOT NULL AND length(trim(p.overview_text)) > 0) AS has_overview_text,
  p.editorial_priority,
  p.manually_seeded,
  CASE
    WHEN (p.ai_bio IS NULL OR length(trim(p.ai_bio))=0)
         AND p.editorial_priority AND p.episode_count >= 1 THEN 'priority_generate_bio'
    WHEN (p.ai_bio IS NULL OR length(trim(p.ai_bio))=0)
         AND (p.is_public OR p.is_indexable) AND p.episode_count >= 3 THEN 'generate_bio'
    WHEN (p.ai_bio IS NULL OR length(trim(p.ai_bio))=0)
         AND (p.is_public OR p.is_indexable) THEN 'manual_review'
    WHEN (p.overview_text IS NULL OR length(trim(p.overview_text))=0)
         AND p.episode_count >= 2 THEN 'generate_overview'
    WHEN (p.ai_bio IS NULL OR length(trim(p.ai_bio))=0) THEN 'hide_or_noindex'
    ELSE 'ok'
  END AS recommended_action,
  CASE
    WHEN p.ai_bio IS NULL OR length(trim(p.ai_bio))=0 THEN 'missing_ai_bio'
    WHEN p.overview_text IS NULL OR length(trim(p.overview_text))=0 THEN 'missing_overview'
    ELSE 'has_content'
  END AS missing_reason,
  (
    SELECT array_agg(e.title ORDER BY e.published_at DESC NULLS LAST)
    FROM (
      SELECT DISTINCT e2.id, e2.title, e2.published_at
      FROM public.person_episode_mentions pem2
      JOIN public.episodes e2 ON e2.id = pem2.episode_id
      JOIN public.podcasts pd2 ON pd2.id = pem2.podcast_id
      WHERE pem2.person_id = p.id
        AND pd2.is_hungarian = true
        AND pd2.language_decision = 'accept_hungarian'
      ORDER BY e2.published_at DESC NULLS LAST
      LIMIT 5
    ) e
  ) AS sample_episode_titles,
  (
    SELECT array_agg(DISTINCT pd.title)
    FROM public.person_podcast_map ppm
    JOIN public.podcasts pd ON pd.id = ppm.podcast_id
    WHERE ppm.person_id = p.id
      AND pd.is_hungarian = true
      AND pd.language_decision = 'accept_hungarian'
  ) AS mapped_podcasts
FROM public.people p;

CREATE OR REPLACE FUNCTION public.admin_person_missing_content(p_limit int DEFAULT 500)
RETURNS SETOF public.person_missing_content_review_view
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.person_missing_content_review_view
  WHERE recommended_action <> 'ok'
  ORDER BY editorial_priority DESC, episode_count DESC NULLS LAST
  LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION public.admin_person_missing_content(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_person_missing_content(int) TO authenticated, service_role;
-- Tighten function body: deny non-admins at call time
CREATE OR REPLACE FUNCTION public.admin_person_missing_content(p_limit int DEFAULT 500)
RETURNS SETOF public.person_missing_content_review_view
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT * FROM public.person_missing_content_review_view
    WHERE recommended_action <> 'ok'
    ORDER BY editorial_priority DESC, episode_count DESC NULLS LAST
    LIMIT p_limit;
END;
$$;
