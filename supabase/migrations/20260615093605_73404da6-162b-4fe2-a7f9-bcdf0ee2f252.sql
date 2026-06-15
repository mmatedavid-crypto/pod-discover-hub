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
  DELETE FROM public.episode_topic_cluster_map WHERE true;
  DELETE FROM public.topic_clusters WHERE true;

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