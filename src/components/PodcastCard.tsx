import { Link } from "react-router-dom";
import { Apple, Music, Youtube, Globe } from "lucide-react";
import { PodcastCover } from "./PodcastCover";
import { snippet } from "@/lib/text";
import { categoryLabel } from "@/lib/categoryLabels";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";

export type PodcastLite = {
  id: string;
  title: string;
  display_title?: string | null;
  slug: string;
  summary?: string | null;
  description?: string | null;
  image_url?: string | null;
  category?: string | null;
  apple_url?: string | null;
  spotify_url?: string | null;
  youtube_url?: string | null;
  website_url?: string | null;
  seo_description?: string | null;
};

export function PodcastCard({ p }: { p: PodcastLite }) {
  const desc = snippet(
    sanitizeHungarianPublicText(p.seo_description)
      || sanitizeHungarianPublicText(p.summary)
      || sanitizeHungarianPublicText(p.description),
    160,
  );
  const title = p.display_title || p.title;
  const displayCategory = categoryLabel(p.category);
  return (
    <article className="group flex gap-3 p-3 sm:p-4 rounded-xl border border-border/70 bg-card/70 card-lift hover:border-primary/40">
      <Link to={`/podcast/${p.slug}`} className="shrink-0 w-20">
        <PodcastCover title={title} src={p.image_url} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/podcast/${p.slug}`} className="font-medium leading-snug line-clamp-2 group-hover:underline">
          {title}
        </Link>
        {displayCategory && <div className="text-xs text-muted-foreground mt-0.5">{displayCategory}</div>}
        {desc && <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{desc}</p>}
        <div className="flex gap-2 mt-2 text-muted-foreground">
          {p.apple_url && <a href={p.apple_url} target="_blank" rel="noreferrer" aria-label="Apple Podcasts" className="hover:text-foreground"><Apple className="h-4 w-4" /></a>}
          {p.spotify_url && <a href={p.spotify_url} target="_blank" rel="noreferrer" aria-label="Spotify" className="hover:text-foreground"><Music className="h-4 w-4" /></a>}
          {p.youtube_url && <a href={p.youtube_url} target="_blank" rel="noreferrer" aria-label="YouTube" className="hover:text-foreground"><Youtube className="h-4 w-4" /></a>}
          {p.website_url && <a href={p.website_url} target="_blank" rel="noreferrer" aria-label="Weboldal" className="hover:text-foreground"><Globe className="h-4 w-4" /></a>}
        </div>
      </div>
    </article>
  );
}
