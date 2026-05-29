
-- =========================================================
-- HU_v1 LIVE CUTOVER — 2026-05-29 (rank_reason is jsonb)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.hu_v1_cutover_backup_20260529 (
  podcast_id            uuid PRIMARY KEY,
  old_rank_label        text,
  old_podiverzum_rank   numeric,
  old_rank_reason       jsonb,
  old_rank_updated_at   timestamptz,
  old_shadow_components jsonb,
  backup_at             timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.hu_v1_cutover_backup_20260529 TO authenticated;
GRANT ALL    ON public.hu_v1_cutover_backup_20260529 TO service_role;

ALTER TABLE public.hu_v1_cutover_backup_20260529 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "backup admin read" ON public.hu_v1_cutover_backup_20260529;
CREATE POLICY "backup admin read"
  ON public.hu_v1_cutover_backup_20260529
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.hu_v1_cutover_backup_20260529
  (podcast_id, old_rank_label, old_podiverzum_rank, old_rank_reason, old_rank_updated_at, old_shadow_components)
SELECT id, rank_label, podiverzum_rank, rank_reason, rank_updated_at, shadow_rank_components
FROM public.podcasts
ON CONFLICT (podcast_id) DO NOTHING;

WITH eligible AS (
  SELECT
    p.id,
    (p.shadow_rank_components->'hu_v1'->>'hu_candidate_tier') AS new_tier,
    LEAST(99.99, GREATEST(0, (p.shadow_rank_components->'hu_v1'->>'final_hu_score')::numeric)) AS new_score,
    (p.shadow_rank_components->'hu_v1'->>'language_gate_flag') AS flag,
    COALESCE((p.shadow_rank_components->'hu_v1'->>'news_like')::boolean, false) AS news_like,
    COALESCE((p.shadow_rank_components->'hu_v1'->>'bulletin_like')::boolean, false) AS bulletin_like
  FROM public.podcasts p
  WHERE p.shadow_rank_components ? 'hu_v1'
    AND (p.shadow_rank_components->'hu_v1' ? 'hu_candidate_tier')
    AND (p.shadow_rank_components->'hu_v1'->>'language_gate_flag') NOT IN
        ('accepted_foreign_false_positive','confirmed_foreign','likely_foreign')
    AND (
      (p.shadow_rank_components->'hu_v1'->>'language_gate_flag') <> 'needs_language_review'
      OR (coalesce(p.title,'') || ' ' || coalesce(p.display_title,'')) ~* '\.hu\b'
      OR coalesce(p.website_url,'') ~* '\.hu\b'
      OR coalesce(p.website_url,'') ~* '/hu/'
    )
)
UPDATE public.podcasts p
SET
  rank_label = e.new_tier,
  podiverzum_rank = e.new_score,
  rank_reason = jsonb_build_object(
    'formula', 'HU_v1',
    'tier', e.new_tier,
    'score', e.new_score,
    'language_gate_flag', e.flag,
    'news_like', e.news_like,
    'bulletin_like', e.bulletin_like,
    'applied_at', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ),
  rank_updated_at = now()
FROM eligible e
WHERE p.id = e.id;

REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_feed;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_evergreen;
