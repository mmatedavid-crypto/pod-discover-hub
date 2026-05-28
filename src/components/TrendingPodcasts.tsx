import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PodcastCover } from "./PodcastCover";
import { Apple, Music, Youtube } from "lucide-react";

type TrendingRow = {
  id: string;
  title: string;
  display_title: string | null;
  slug: string;
  image_url: string | null;
  category: string | null;
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
      <div className="flex items-end justify-between mb-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Felkapott műsorok</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Az Apple Podcasts és YouTube top listái alapján — naponta frissül.
          </p>
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
        {items.map((p) => {
          const title = p.display_title || p.title;
          return (
            <Link
              key={p.id}
              to={`/podcast/${p.slug}`}
              className="group shrink-0 snap-start w-36 sm:w-40"
            >
              <div className="relative">
                <PodcastCover title={title} src={p.image_url} />
              </div>
              <div className="mt-2 font-medium text-sm leading-snug line-clamp-2 group-hover:underline">
                {title}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                {p.sources?.map((s) => {
                  const Icon = ICON[s.source];
                  return (
                    <span key={s.source} className="inline-flex items-center gap-1" title={`#${s.rank} ${LABEL[s.source]}`}>
                      {Icon && <Icon className="h-3 w-3" />}#{s.rank}
                    </span>
                  );
                })}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
