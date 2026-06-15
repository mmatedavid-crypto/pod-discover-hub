-- Add person redirect target to topic_clusters so person-name clusters can
-- redirect to the canonical /szemelyek/{slug} page instead of showing as topics.
ALTER TABLE public.topic_clusters
  ADD COLUMN IF NOT EXISTS redirect_person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS redirect_person_slug text;

CREATE INDEX IF NOT EXISTS idx_topic_clusters_redirect_person
  ON public.topic_clusters(redirect_person_slug) WHERE redirect_person_slug IS NOT NULL;

-- Backfill: where the cluster label exactly matches a public person's name,
-- point the cluster at that person AND drop it from public topic surfaces.
WITH matches AS (
  SELECT DISTINCT ON (tc.id)
    tc.id AS cluster_id,
    p.id  AS person_id,
    p.slug AS person_slug
  FROM public.topic_clusters tc
  JOIN public.people p
    ON lower(p.name) = lower(tc.canonical_label_hu)
   AND p.is_public = true
   AND p.slug IS NOT NULL
  ORDER BY tc.id, p.episode_count DESC NULLS LAST
)
UPDATE public.topic_clusters tc
SET
  redirect_person_id   = m.person_id,
  redirect_person_slug = m.person_slug,
  is_public            = false,
  is_indexable         = false
FROM matches m
WHERE tc.id = m.cluster_id;