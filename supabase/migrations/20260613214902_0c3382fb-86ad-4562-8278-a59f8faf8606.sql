
-- 1) topic_clusters
CREATE TABLE IF NOT EXISTS public.topic_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  canonical_label_hu text NOT NULL,
  description text,
  member_labels text[] NOT NULL DEFAULT '{}',
  episode_count integer NOT NULL DEFAULT 0,
  is_indexable boolean NOT NULL DEFAULT false,
  is_public boolean NOT NULL DEFAULT true,
  cluster_method text NOT NULL DEFAULT 'deterministic_v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.topic_clusters TO anon, authenticated;
GRANT ALL ON public.topic_clusters TO service_role;
ALTER TABLE public.topic_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "topic_clusters public read" ON public.topic_clusters
  FOR SELECT USING (is_public = true);
CREATE POLICY "topic_clusters admin manage" ON public.topic_clusters
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS topic_clusters_indexable_idx ON public.topic_clusters (is_indexable, episode_count DESC);

-- 2) episode_topic_cluster_map
CREATE TABLE IF NOT EXISTS public.episode_topic_cluster_map (
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  cluster_id uuid NOT NULL REFERENCES public.topic_clusters(id) ON DELETE CASCADE,
  source_label text,
  confidence numeric NOT NULL DEFAULT 0.8,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (episode_id, cluster_id)
);
GRANT SELECT ON public.episode_topic_cluster_map TO anon, authenticated;
GRANT ALL ON public.episode_topic_cluster_map TO service_role;
ALTER TABLE public.episode_topic_cluster_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "etcm public read" ON public.episode_topic_cluster_map
  FOR SELECT USING (true);
CREATE POLICY "etcm admin manage" ON public.episode_topic_cluster_map
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS etcm_cluster_idx ON public.episode_topic_cluster_map (cluster_id);
CREATE INDEX IF NOT EXISTS etcm_episode_idx ON public.episode_topic_cluster_map (episode_id);

-- 3) Lock down the legacy noisy tables
REVOKE SELECT ON public.episode_extracted_topics FROM anon, authenticated;
REVOKE SELECT ON public.episode_ai_classifications FROM anon, authenticated;

-- 4) Recompute RPC
CREATE OR REPLACE FUNCTION public.recompute_topic_cluster_counts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.topic_clusters tc
  SET episode_count = sub.cnt,
      is_indexable = (sub.cnt >= 3),
      updated_at = now()
  FROM (
    SELECT cluster_id, count(DISTINCT episode_id) AS cnt
    FROM public.episode_topic_cluster_map
    GROUP BY cluster_id
  ) sub
  WHERE tc.id = sub.cluster_id;

  UPDATE public.topic_clusters
  SET episode_count = 0, is_indexable = false, updated_at = now()
  WHERE id NOT IN (SELECT cluster_id FROM public.episode_topic_cluster_map);
END;
$$;
GRANT EXECUTE ON FUNCTION public.recompute_topic_cluster_counts() TO authenticated, service_role;
