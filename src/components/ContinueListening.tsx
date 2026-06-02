import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { History, X } from "lucide-react";
import { getRecentEpisodes, clearRecentEpisodes, RecentEpisode } from "@/lib/recentlyPlayed";
import { imageSrcSet, optimizedImageUrl } from "@/lib/image";

export function ContinueListening() {
  const [items, setItems] = useState<RecentEpisode[]>([]);

  useEffect(() => {
    setItems(getRecentEpisodes());
  }, []);

  if (!items.length) return null;

  return (
    <section>
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">
            <History className="h-3 w-3" /> Folytatás
          </div>
          <h2 className="text-xl sm:text-2xl font-semibold">Ahol abbahagytad</h2>
        </div>
        <button
          type="button"
          onClick={() => {
            clearRecentEpisodes();
            setItems([]);
          }}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <X className="h-3 w-3" /> Törlés
        </button>
      </div>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {items.slice(0, 8).map((it) => (
          <Link
            key={`${it.podcastSlug}/${it.episodeSlug}`}
            to={`/podcast/${it.podcastSlug}/${it.episodeSlug}`}
            className="group flex gap-3 p-3 rounded-xl border border-border/60 bg-card/40 hover:border-primary/40 transition-colors"
          >
            {it.imageUrl ? (
              <img
                src={optimizedImageUrl(it.imageUrl, { width: 80, height: 80 }) || it.imageUrl}
                srcSet={imageSrcSet(it.imageUrl, [56, 80, 112])}
                sizes="56px"
                alt=""
                loading="lazy"
                decoding="async"
                width={80}
                height={80}
                className="h-14 w-14 rounded-md object-cover flex-shrink-0"
              />
            ) : (
              <div className="h-14 w-14 rounded-md bg-secondary flex-shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                {it.title}
              </div>
              <div className="text-xs text-muted-foreground mt-1 truncate">{it.podcastTitle}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
