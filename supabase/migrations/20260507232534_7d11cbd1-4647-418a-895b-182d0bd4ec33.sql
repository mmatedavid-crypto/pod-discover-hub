-- Done-marker-before-LIMIT candidate selector for embed runner.
-- Excludes podcasts that already have a podcast_embeddings row for the
-- given model, plus bad-health rows, BEFORE applying ORDER BY / LIMIT.
CREATE OR REPLACE FUNCTION public.select_embed_candidates(_model text, _tiers text[], _limit int)
RETURNS TABLE(
  id uuid,
  title text,
  display_title text,
  description text,
  seo_description text,
  category text,
  rank_label text,
  shadow_rank_components jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.title, p.display_title, p.description, p.seo_description,
         p.category, p.rank_label, p.shadow_rank_components
    FROM public.podcasts p
    LEFT JOIN public.podcast_embeddings e
      ON e.podcast_id = p.id AND e.model = _model
   WHERE p.rank_label = ANY(_tiers)
     AND e.podcast_id IS NULL
     AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN
         ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam')
   ORDER BY array_position(ARRAY['S','A','B','C','D','E']::text[], p.rank_label) NULLS LAST,
            p.podiverzum_rank DESC NULLS LAST
   LIMIT _limit;
$$;

-- Diagnostic helper used by the runner for embed_progress reporting.
CREATE OR REPLACE FUNCTION public.embed_candidate_stats(_model text, _tiers text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH tiered AS (
    SELECT p.id, p.shadow_rank_components->>'health_state' AS hs
      FROM public.podcasts p
     WHERE p.rank_label = ANY(_tiers)
  ),
  healthy AS (
    SELECT id FROM tiered
     WHERE COALESCE(hs,'') NOT IN
       ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam')
  ),
  embedded AS (
    SELECT podcast_id FROM public.podcast_embeddings WHERE model = _model
  )
  SELECT jsonb_build_object(
    'eligible_total', (SELECT count(*) FROM healthy),
    'already_embedded_current_model', (SELECT count(*) FROM embedded e JOIN healthy h ON h.id = e.podcast_id),
    'missing_embedding', (SELECT count(*) FROM healthy h WHERE NOT EXISTS (SELECT 1 FROM embedded e WHERE e.podcast_id = h.id)),
    'skipped_bad_health', (SELECT count(*) FROM tiered WHERE COALESCE(hs,'') IN ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam'))
  );
$$;