import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PodcastCard, PodcastLite } from "./PodcastCard";
import { Sparkles } from "lucide-react";
import { SMART_PLAYER_RECOMMENDATIONS_ENABLED } from "@/components/smart-player/recommendationsConfig";

type Row = PodcastLite & {
  similarity: number;
  final_score: number;
  episode_count: number | null;
  latest_episode_at: string | null;
};

const MIN_RESULTS = 3;

export function SimilarPodcasts({ podcastId, limit = 8 }: { podcastId: string; limit?: number }) {
  if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return null;

  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .rpc("get_similar_podcasts_by_embedding", { p_podcast_id: podcastId, p_limit: limit })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !Array.isArray(data)) setItems([]);
        else setItems(data as Row[]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [podcastId, limit]);

  if (loading || items.length < MIN_RESULTS) return null;
  return (
    <section className="mt-12">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">Hasonló podcastok</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-3">Hasonló témájú magyar podcastok.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((p) => <PodcastCard key={p.id} p={p} />)}
      </div>
    </section>
  );
}
