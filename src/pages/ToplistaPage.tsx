import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { PodcastCover } from "@/components/PodcastCover";
import { Apple, Music, Youtube } from "lucide-react";
import { categoryLabel } from "@/lib/categoryLabels";
import { breadcrumbJsonLd, setSeo } from "@/lib/seo";

type Row = {
  id: string;
  title: string;
  display_title: string | null;
  slug: string;
  image_url: string | null;
  category: string | null;
  trending_score: number;
  sources: { source: "apple" | "spotify" | "youtube"; rank: number }[];
  snapshot_at: string;
};

const ICON: Record<string, any> = { apple: Apple, spotify: Music, youtube: Youtube };
const LABEL: Record<string, string> = { apple: "Apple", spotify: "Spotify", youtube: "YouTube" };
type Filter = "all" | "all3" | "apple" | "spotify" | "youtube";

export default function ToplistaPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    const canonical = "https://podiverzum.hu/toplista";
    setSeo({
      title: "Magyar podcast toplista — Apple, Spotify, YouTube fúzió | Podiverzum",
      description: "Az első magyar abszolút podcast toplista: az Apple Podcasts, Spotify és YouTube toplistáit fúzionáljuk egyetlen rangsorba. Naponta frissül.",
      canonical,
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Magyar podcast toplista",
          description: "Apple, Spotify és YouTube toplistákból készülő magyar podcast rangsor.",
          url: canonical,
          inLanguage: "hu-HU",
          isAccessibleForFree: true,
        },
        breadcrumbJsonLd([
          { name: "Podiverzum", url: "https://podiverzum.hu/" },
          { name: "Toplista", url: canonical },
        ]),
      ],
    });
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("get_trending_podcasts", { p_limit: 100 });
      setRows(((data as any[]) || []) as Row[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "all3")
      return rows.filter((r) => new Set(r.sources.map((s) => s.source)).size >= 3);
    return rows.filter((r) => r.sources.some((s) => s.source === filter));
  }, [rows, filter]);

  const snapshot = rows[0]?.snapshot_at;
  const snapshotLabel = snapshot
    ? new Date(snapshot).toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric" })
    : "";

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "Mind" },
    { id: "all3", label: "Mindhárom platformon" },
    { id: "apple", label: "Apple" },
    { id: "spotify", label: "Spotify" },
    { id: "youtube", label: "YouTube" },
  ];

  return (
    <Layout>
      <div className="container mx-auto py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Magyar podcast toplista</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Az Apple Podcasts, Spotify és YouTube hivatalos magyar top listáit fúzionáljuk egyetlen rangsorba
            reciprokrang-fúzióval: minél több platformon áll jól egy műsor, annál erősebb a toplista-mutatója.
            Naponta frissül.
          </p>
          {snapshotLabel && (
            <p className="text-xs text-muted-foreground">Friss mérés: {snapshotLabel}</p>
          )}
          <div className="pt-2 flex flex-wrap gap-2">
            <Link
              to="/toplista/all-time"
              className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-foreground bg-foreground text-background hover:opacity-90 transition"
            >
              🏆 Minden idők legnézettebb epizódjai →
            </Link>
            <Link
              to="/podcastok/abc"
              className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-border bg-card hover:border-primary/40 transition"
            >
              Összes magyar podcast A–Z →
            </Link>
          </div>
        </header>

        <div className="flex flex-wrap gap-2">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-full border text-xs transition ${
                filter === f.id
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card border-border hover:bg-secondary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-muted-foreground text-sm">Töltés…</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground text-sm">Nincs találat ehhez a szűrőhöz.</div>
        ) : (
          <ol className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
            {filtered.map((p, idx) => {
              const title = p.display_title || p.title;
              const displayCategory = categoryLabel(p.category);
              return (
                <li key={p.id}>
                  <Link
                    to={`/podcast/${p.slug}`}
                    className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 hover:bg-secondary/60 transition"
                  >
                    <div className="w-8 sm:w-10 text-right text-lg sm:text-xl font-semibold tabular-nums text-muted-foreground shrink-0">
                      {idx + 1}
                    </div>
                    <div className="w-14 sm:w-16 shrink-0">
                      <PodcastCover title={title} src={p.image_url} size="sm" loading="lazy" fetchPriority="low" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium leading-snug line-clamp-2">{title}</div>
                      {displayCategory && (
                        <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                          {displayCategory}
                        </div>
                      )}
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        {p.sources?.map((s) => {
                          const Icon = ICON[s.source];
                          return (
                            <span
                              key={s.source}
                              className="inline-flex items-center gap-1"
                              title={`#${s.rank} ${LABEL[s.source]}`}
                            >
                              {Icon && <Icon className="h-3 w-3" />}
                              {LABEL[s.source]} #{s.rank}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="hidden sm:block text-right text-xs text-muted-foreground tabular-nums shrink-0">
                      mutató {p.trending_score.toFixed(3)}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}

        <section className="mt-10 pt-6 border-t border-border text-xs text-muted-foreground space-y-2 max-w-2xl">
          <h2 className="text-sm font-semibold text-foreground">Módszertan</h2>
          <p>
            Forrás: Apple Podcasts magyar top 100, Spotify magyar top 50 (podcastcharts.byspotify.com), YouTube
            magyar podcastcsatornák nézettségi mozgása. Minden műsorra összegezzük a források reciprok
            rangját — a magasabb toplista-mutató azt jelenti, hogy a műsor egyszerre több platformon is előkelőbb
            helyen szerepel. A mérések napi rendszerességgel készülnek, így rövidesen heti/havi
            mozgásokat is publikálunk: új belépők, kiesők és platformok közötti eltérések.
          </p>
        </section>
      </div>
    </Layout>
  );
}
