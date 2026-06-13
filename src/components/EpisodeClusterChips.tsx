import { Link } from "react-router-dom";
import { Hash } from "lucide-react";
import { useEpisodeClusters } from "@/hooks/useEpisodeClusters";

/**
 * The ONLY trustworthy source of topic chips on the public site:
 * deterministic Hungarian topic_clusters built from episode_extracted_topics.
 *
 * Replaces the legacy `episodes.topics` raw RSS/AI tag array.
 */
export function EpisodeClusterChips({
  episodeId,
  limit = 6,
  className = "",
}: {
  episodeId: string;
  limit?: number;
  className?: string;
}) {
  const { clusters, loading } = useEpisodeClusters(episodeId, limit);
  if (loading || clusters.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {clusters.map((c) => (
        <Link
          key={c.cluster_id}
          to={`/temak/k/${c.slug}`}
          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card/60 px-2.5 py-1 text-xs text-foreground/85 hover:border-primary/50 hover:text-primary transition-colors"
        >
          <Hash className="h-3 w-3 opacity-70" />
          <span className="truncate max-w-[180px]">{c.label}</span>
        </Link>
      ))}
    </div>
  );
}
