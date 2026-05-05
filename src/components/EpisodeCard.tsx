import { Link } from "react-router-dom";
import { PodcastCover } from "./PodcastCover";
import { ExternalLink } from "lucide-react";

export type EpisodeLite = {
  id: string;
  title: string;
  slug: string;
  summary?: string | null;
  description?: string | null;
  published_at?: string | null;
  audio_url?: string | null;
  episode_rank?: number | null;
  topics?: string[] | null;
  podcasts: {
    slug: string;
    title: string;
    image_url?: string | null;
    category?: string | null;
    podiverzum_rank?: number | null;
  };
};

export function EpisodeCard({ e, showTopics = false }: { e: EpisodeLite; showTopics?: boolean }) {
  const p = e.podcasts;
  return (
    <article className="group flex gap-3 p-4 hover:bg-secondary/40 transition-colors">
      <Link to={`/podcast/${p.slug}`} className="shrink-0 w-16 sm:w-20">
        <PodcastCover title={p.title} src={p.image_url} size="sm" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/podcast/${p.slug}/${e.slug}`} className="font-medium leading-snug line-clamp-2 group-hover:underline">
          {e.title}
        </Link>
        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-2 gap-y-0.5 items-center">
          <Link to={`/podcast/${p.slug}`} className="hover:text-foreground font-medium">{p.title}</Link>
          {p.category && <span>· {p.category}</span>}
          {e.published_at && <span>· {new Date(e.published_at).toLocaleDateString()}</span>}
          {typeof e.episode_rank === "number" && e.episode_rank > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-secondary text-[10px]">Ep rank {e.episode_rank}</span>
          )}
          {typeof p.podiverzum_rank === "number" && p.podiverzum_rank > 0 && (
            <span className="text-[10px] text-muted-foreground">/ Pod {p.podiverzum_rank}</span>
          )}
        </div>
        {(e.summary || e.description) && (
          <p className="text-sm text-muted-foreground line-clamp-2 mt-1.5">{e.summary || e.description}</p>
        )}
        {showTopics && e.topics && e.topics.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {e.topics.slice(0, 5).map((t) => (
              <Link key={t} to={`/search?q=${encodeURIComponent(t)}`} className="px-2 py-0.5 rounded-full bg-secondary text-[11px] hover:bg-accent hover:text-accent-foreground">
                {t}
              </Link>
            ))}
          </div>
        )}
        <div className="flex gap-3 mt-2 text-xs">
          <Link to={`/podcast/${p.slug}/${e.slug}`} className="text-muted-foreground hover:text-foreground">Open episode</Link>
          {e.audio_url && (
            <a href={e.audio_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3 w-3" /> Listen
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function EpisodeList({ items, showTopics = false, empty = "No episodes yet." }: { items: EpisodeLite[]; showTopics?: boolean; empty?: string }) {
  if (!items.length) return <div className="text-muted-foreground text-sm p-4">{empty}</div>;
  return (
    <ul className="divide-y divide-border border border-border rounded-lg bg-card">
      {items.map((e) => (
        <li key={e.id}>
          <EpisodeCard e={e} showTopics={showTopics} />
        </li>
      ))}
    </ul>
  );
}
