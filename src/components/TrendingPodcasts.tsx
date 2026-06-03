import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PodcastCover } from "./PodcastCover";
import { Apple, ArrowRight, Music, Trophy, Youtube } from "lucide-react";
import { snippet } from "@/lib/text";
import { categoryLabel } from "@/lib/categoryLabels";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";

type TrendingRow = {
  id: string;
  title: string;
  display_title: string | null;
  slug: string;
  image_url: string | null;
  category: string | null;
  summary?: string | null;
  description?: string | null;
  sources: { source: "apple" | "spotify" | "youtube"; rank: number }[];
};

const ICON: Record<string, any> = { apple: Apple, spotify: Music, youtube: Youtube };
const LABEL: Record<string, string> = { apple: "Apple", spotify: "Spotify", youtube: "YouTube" };

export function TrendingPodcasts() {
  const [items, setItems] = useState<TrendingRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("get_trending_podcasts", { p_limit: 12 });
      setItems(((data as any[]) || []) as TrendingRow[]);
      setLoaded(true);
    })();
  }, []);

  if (!loaded || items.length === 0) return null;

  return (
    <section>
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary/90 mb-1">
            <Trophy className="h-3 w-3" /> Toplisták
          </div>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Népszerű most</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Apple, Spotify és YouTube jelekből számolt magyar toplista.
          </p>
        </div>
        <Link to="/toplista" className="hidden sm:inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          Toplista <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
        {items.map((p, index) => {
          const title = p.display_title || p.title;
          const desc = snippet(sanitizeHungarianPublicText(p.summary) || sanitizeHungarianPublicText(p.description), 92);
          const lead = index === 0;
          const displayCategory = categoryLabel(p.category);
          return (
            <Link
              key={p.id}
              to={`/podcast/${p.slug}`}
              className={[
                "group shrink-0 snap-start overflow-hidden rounded-lg border border-border/70 bg-card/80 shadow-sm transition-all hover:border-primary/50 hover:bg-card",
                lead ? "w-[76vw] max-w-[320px] sm:w-72" : "w-[46vw] max-w-[190px] sm:w-48",
              ].join(" ")}
            >
              <div className="relative aspect-square overflow-hidden bg-secondary">
                <PodcastCover title={title} src={p.image_url} size={lead ? "lg" : undefined} />
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-background/85 to-transparent" />
                <div className="absolute left-2 top-2 rounded-md bg-background/80 px-2 py-1 text-[11px] font-semibold text-foreground backdrop-blur">
                  #{index + 1}
                </div>
              </div>
              <div className="p-3">
                <div className="font-semibold text-sm sm:text-base leading-snug line-clamp-2 group-hover:underline">
                  {title}
                </div>
                {lead && desc && (
                  <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{desc}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  {p.sources?.slice(0, 3).map((s) => {
                    const Icon = ICON[s.source];
                    return (
                      <span key={s.source} className="inline-flex items-center gap-1" title={`#${s.rank} ${LABEL[s.source]}`}>
                        {Icon && <Icon className="h-3 w-3" />}#{s.rank}
                      </span>
                    );
                  })}
                </div>
                {displayCategory && (
                  <div className="mt-2 text-[11px] text-muted-foreground/80 line-clamp-1">{displayCategory}</div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
      <Link to="/toplista" className="mt-2 inline-flex sm:hidden items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        Teljes toplista <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}
