import { Link } from "react-router-dom";
import { Apple, Music, Youtube, Globe } from "lucide-react";

export type PodcastLite = {
  id: string;
  title: string;
  slug: string;
  summary?: string | null;
  description?: string | null;
  image_url?: string | null;
  category?: string | null;
  apple_url?: string | null;
  spotify_url?: string | null;
  youtube_url?: string | null;
  website_url?: string | null;
};

export function PodcastCard({ p }: { p: PodcastLite }) {
  return (
    <article className="group flex gap-3 p-3 rounded-lg border border-border bg-card hover:border-accent/40 transition-colors">
      <Link to={`/podcast/${p.slug}`} className="shrink-0">
        <div className="w-20 h-20 rounded-md bg-muted overflow-hidden">
          {p.image_url ? (
            <img src={p.image_url} alt={p.title} loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No image</div>
          )}
        </div>
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/podcast/${p.slug}`} className="font-medium leading-snug line-clamp-2 group-hover:text-accent">
          {p.title}
        </Link>
        {p.category && <div className="text-xs text-muted-foreground mt-0.5">{p.category}</div>}
        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{p.summary || p.description}</p>
        <div className="flex gap-2 mt-2 text-muted-foreground">
          {p.apple_url && <a href={p.apple_url} target="_blank" rel="noreferrer" aria-label="Apple Podcasts" className="hover:text-accent"><Apple className="h-4 w-4" /></a>}
          {p.spotify_url && <a href={p.spotify_url} target="_blank" rel="noreferrer" aria-label="Spotify" className="hover:text-accent"><Music className="h-4 w-4" /></a>}
          {p.youtube_url && <a href={p.youtube_url} target="_blank" rel="noreferrer" aria-label="YouTube" className="hover:text-accent"><Youtube className="h-4 w-4" /></a>}
          {p.website_url && <a href={p.website_url} target="_blank" rel="noreferrer" aria-label="Website" className="hover:text-accent"><Globe className="h-4 w-4" /></a>}
        </div>
      </div>
    </article>
  );
}
