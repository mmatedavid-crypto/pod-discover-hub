CREATE TABLE IF NOT EXISTS public.topic_cluster_staging (
  id bigserial PRIMARY KEY,
  slug text NOT NULL,
  canonical_label_hu text NOT NULL,
  member_labels text[] NOT NULL DEFAULT '{}',
  episode_ids uuid[] NOT NULL,
  avg_confidence numeric NOT NULL DEFAULT 0.8,
  cluster_method text NOT NULL DEFAULT 'deterministic_v1',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.topic_cluster_staging TO authenticated;
GRANT ALL ON public.topic_cluster_staging TO service_role;

ALTER TABLE public.topic_cluster_staging ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_staging" ON public.topic_cluster_staging;
CREATE POLICY "service_role_all_staging" ON public.topic_cluster_staging
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "admin_read_staging" ON public.topic_cluster_staging;
CREATE POLICY "admin_read_staging" ON public.topic_cluster_staging
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.apply_topic_cluster_staging()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clusters int := 0;
  v_map int := 0;
BEGIN
  DELETE FROM public.episode_topic_cluster_map;
  DELETE FROM public.topic_clusters;

  WITH numbered AS (
    SELECT
      s.id AS staging_id,
      s.slug,
      s.canonical_label_hu,
      s.member_labels,
      s.cluster_method,
      s.episode_ids,
      s.avg_confidence,
      row_number() OVER (PARTITION BY s.slug ORDER BY s.id) AS rn
    FROM public.topic_cluster_staging s
  ),
  final AS (
    SELECT
      staging_id,
      CASE WHEN rn = 1 THEN slug ELSE slug || '-' || rn::text END AS final_slug,
      canonical_label_hu,
      member_labels,
      cluster_method,
      episode_ids,
      avg_confidence
    FROM numbered
  ),
  ins_clusters AS (
    INSERT INTO public.topic_clusters (slug, canonical_label_hu, member_labels, cluster_method)
    SELECT final_slug, canonical_label_hu, member_labels, cluster_method FROM final
    RETURNING id, slug
  ),
  cluster_ct AS (SELECT count(*)::int AS n FROM ins_clusters),
  joined AS (
    SELECT
      ic.id AS cluster_id,
      f.canonical_label_hu,
      f.avg_confidence,
      f.episode_ids
    FROM final f
    JOIN public.topic_clusters ic ON ic.slug = f.final_slug
  ),
  ins_map AS (
    INSERT INTO public.episode_topic_cluster_map (episode_id, cluster_id, source_label, confidence)
    SELECT ep_id, j.cluster_id, j.canonical_label_hu, j.avg_confidence
    FROM joined j
    CROSS JOIN LATERAL unnest(j.episode_ids) AS ep_id
    ON CONFLICT (episode_id, cluster_id) DO NOTHING
    RETURNING 1
  )
  SELECT
    (SELECT n FROM cluster_ct),
    (SELECT count(*) FROM ins_map)
  INTO v_clusters, v_map;

  PERFORM public.recompute_topic_cluster_counts();

  RETURN jsonb_build_object(
    'clusters', v_clusters,
    'map_rows', v_map,
    'staging_rows', (SELECT count(*) FROM public.topic_cluster_staging)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_topic_cluster_staging() TO service_role;