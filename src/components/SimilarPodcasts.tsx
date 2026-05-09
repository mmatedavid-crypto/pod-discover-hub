import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PodcastCard, PodcastLite } from "./PodcastCard";
import { Sparkles } from "lucide-react";

type Row = PodcastLite & { similarity: number };

export function SimilarPodcasts({ podcastId, limit = 6 }: { podcastId: string; limit?: number }) {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .rpc("similar_podcasts" as any, { p_podcast_id: podcastId, p_limit: limit })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !Array.isArray(data)) setItems([]);
        else setItems(data as Row[]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [podcastId, limit]);

  if (loading || items.length === 0) return null;
  return (
    <section className="mt-12">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">If you like this, try…</h2>
        <span className="text-[11px] text-muted-foreground">Sound-alike podcasts</span>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((p) => <PodcastCard key={p.id} p={p} />)}
      </div>
    </section>
  );
}
