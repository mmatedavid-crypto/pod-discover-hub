
-- 1. Schema additions on person_episode_mentions
ALTER TABLE public.person_episode_mentions
  ADD COLUMN IF NOT EXISTS role_type text,
  ADD COLUMN IF NOT EXISTS role_confidence numeric,
  ADD COLUMN IF NOT EXISTS source_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS role_reason text;

-- 2. Backfill role_type from existing mention_type
UPDATE public.person_episode_mentions
SET role_type = CASE
  WHEN mention_type IN ('host','guest','interviewee','speaker','archival_source') THEN 'participant'
  WHEN mention_type = 'subject' THEN 'subject'
  WHEN mention_type = 'mentioned' THEN 'mention'
  ELSE 'mention'
END,
role_confidence = COALESCE(role_confidence, confidence)
WHERE role_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_pem_person_role
  ON public.person_episode_mentions (person_id, role_type);

-- 3. Schema additions on people (precomputed role counts)
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS participant_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mention_count integer NOT NULL DEFAULT 0;

-- 4. Recompute function — totals based on accepted/strong relevance only
CREATE OR REPLACE FUNCTION public.recompute_person_role_counts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE updated_count integer;
BEGIN
  WITH gated AS (
    SELECT pem.person_id, pem.role_type, pem.episode_id
    FROM public.person_episode_mentions pem
    JOIN public.episodes e   ON e.id = pem.episode_id
    JOIN public.podcasts p   ON p.id = e.podcast_id
    WHERE p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND (
        pem.relevance_status = 'accepted'
        OR COALESCE(pem.final_relevance_score, 0) >= 0.75
        OR pem.validation_source = 'manual'
        OR (
          (pem.relevance_status IS NULL OR pem.relevance_status = 'pending')
          AND pem.role_type IN ('participant','subject')
          AND COALESCE(pem.confidence, 0) >= 0.80
        )
      )
      AND COALESCE(pem.relevance_status, '') NOT IN ('rejected','needs_review')
  ),
  agg AS (
    SELECT
      person_id,
      COUNT(DISTINCT episode_id) FILTER (WHERE role_type = 'participant') AS participant_count,
      COUNT(DISTINCT episode_id) FILTER (WHERE role_type = 'subject')     AS subject_count,
      COUNT(DISTINCT episode_id) FILTER (WHERE role_type = 'mention')     AS mention_count
    FROM gated
    GROUP BY person_id
  )
  UPDATE public.people p
  SET participant_count = COALESCE(a.participant_count, 0),
      subject_count     = COALESCE(a.subject_count, 0),
      mention_count     = COALESCE(a.mention_count, 0)
  FROM agg a
  WHERE p.id = a.person_id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

SELECT public.recompute_person_role_counts();
