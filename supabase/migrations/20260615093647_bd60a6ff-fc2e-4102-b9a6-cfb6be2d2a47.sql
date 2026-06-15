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

  -- Insert clusters with dedup slug
  WITH numbered AS (
    SELECT
      s.id AS staging_id,
      CASE WHEN row_number() OVER (PARTITION BY s.slug ORDER BY s.id) = 1
        THEN s.slug
        ELSE s.slug || '-' || row_number() OVER (PARTITION BY s.slug ORDER BY s.id)::text
      END AS final_slug,
      s.canonical_label_hu,
      s.member_labels,
      s.cluster_method
    FROM public.topic_cluster_staging s
  )
  INSERT INTO public.topic_clusters (slug, canonical_label_hu, member_labels, cluster_method)
  SELECT final_slug, canonical_label_hu, member_labels, cluster_method FROM numbered;

  GET DIAGNOSTICS v_clusters = ROW_COUNT;

  -- Now expand map rows by joining staging.canonical_label_hu → topic_clusters
  WITH numbered AS (
    SELECT
      s.id AS staging_id,
      CASE WHEN row_number() OVER (PARTITION BY s.slug ORDER BY s.id) = 1
        THEN s.slug
        ELSE s.slug || '-' || row_number() OVER (PARTITION BY s.slug ORDER BY s.id)::text
      END AS final_slug,
      s.episode_ids,
      s.avg_confidence,
      s.canonical_label_hu
    FROM public.topic_cluster_staging s
  ),
  expanded AS (
    INSERT INTO public.episode_topic_cluster_map (episode_id, cluster_id, source_label, confidence)
    SELECT ep_id, tc.id, n.canonical_label_hu, n.avg_confidence
    FROM numbered n
    JOIN public.topic_clusters tc ON tc.slug = n.final_slug
    CROSS JOIN LATERAL unnest(n.episode_ids) AS ep_id
    ON CONFLICT (episode_id, cluster_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_map FROM expanded;

  PERFORM public.recompute_topic_cluster_counts();

  RETURN jsonb_build_object(
    'clusters', v_clusters,
    'map_rows', v_map,
    'staging_rows', (SELECT count(*) FROM public.topic_cluster_staging)
  );
END;
$$;