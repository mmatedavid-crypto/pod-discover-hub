import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type EpisodeCluster = {
  cluster_id: string;
  slug: string;
  label: string;
  episode_count: number;
  confidence: number;
};

/**
 * Fetches topic_clusters mapped to a single episode (the only source of
 * trustworthy, Hungarian, canonical topic chips). Strongest clusters first.
 */
export function useEpisodeClusters(episodeId: string | null | undefined, limit = 6) {
  const [clusters, setClusters] = useState<EpisodeCluster[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!episodeId) { setClusters([]); return; }
    let alive = true;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("episode_topic_cluster_map")
        .select("cluster_id, confidence, topic_clusters!inner(slug, canonical_label_hu, episode_count, is_public)")
        .eq("episode_id", episodeId);
      if (!alive) return;
      const rows = (data || [])
        .map((r: any) => ({
          cluster_id: r.cluster_id as string,
          slug: r.topic_clusters?.slug as string,
          label: r.topic_clusters?.canonical_label_hu as string,
          episode_count: Number(r.topic_clusters?.episode_count || 0),
          confidence: Number(r.confidence || 0),
          is_public: !!r.topic_clusters?.is_public,
        }))
        .filter((r) => r.is_public && r.slug && r.label)
        .sort((a, b) => b.episode_count - a.episode_count || b.confidence - a.confidence)
        .slice(0, limit);
      setClusters(rows);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [episodeId, limit]);

  return { clusters, loading };
}
