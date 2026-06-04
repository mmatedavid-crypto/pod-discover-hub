import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { Trophy } from "lucide-react";
import { breadcrumbJsonLd, setSeo } from "@/lib/seo";

type Row = {
  episode_id: string;
  episode_slug: string;
  episode_title: string;
  episode_image: string | null;
  published_at: string | null;
  view_count: number;
  youtube_video_id: string | null;
  podcast_id: string;
  podcast_slug: string;
  podcast_title: string;
  podcast_image: string | null;
  rank_label: string | null;
  chart_appearances: number;
  popularity_score: number;
};

type Mode = "all" | "per-podcast";

const PAGE_SIZE = 100;


export default function ToplistaAllTimePage() {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get("mode") === "per-podcast" ? "per-podcast" : "all";
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const canonical = "https://podiverzum.hu/toplista/all-time";
    setSeo({
      title: "Minden idők legnézettebb magyar podcast epizódjai | Podiverzum",
      description: "A YouTube-on legtöbbet megnézett magyar podcast epizódok minden idők rangsora. Friderikusztól Partizánig, a rekordinterjúk egy helyen.",
      canonical,
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Minden idők legnézettebb magyar podcast epizódjai",
          description: "A YouTube-on legtöbbet megnézett magyar podcast epizódok rangsora.",
          url: canonical,
          inLanguage: "hu-HU",
          isAccessibleForFree: true,
        },
        breadcrumbJsonLd([
          { name: "Podiverzum", url: "https://podiverzum.hu/" },
          { name: "Toplista", url: "https://podiverzum.hu/toplista" },
          { name: "Minden idők", url: canonical },
        ]),
      ],
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc("top_episodes_all_time", {
        p_limit: PAGE_SIZE,
        p_offset: 0,
        p_podcast_slug: null,
        p_one_per_podcast: mode === "per-podcast",
      });
      if (cancelled) return;
      if (error) console.error("top_episodes_all_time", error);
      setRows(((data as any[]) || []) as Row[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const setMode = (m: Mode) => {
    const next = new URLSearchParams(params);
    if (m === "all") next.delete("mode");
    else next.set("mode", m);
    setParams(next, { replace: true });
  };

  const topThree = useMemo(() => rows.slice(0, 3), [rows]);

  return (
    <Layout>
      <div className="container mx-auto py-8 space-y-8">
        <header className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Trophy className="h-4 w-4" />
            <span>Minden idők toplistája</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Minden idők legnézettebb magyar podcast epizódjai
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            A YouTube-on mért legtöbb megtekintést elért magyar podcast epizódok rangsora.
          </p>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={() => setMode("all")}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${
                mode === "all"
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background text-foreground border-border hover:bg-muted"
              }`}
            >
              Összes epizód
            </button>
            <button
              onClick={() => setMode("per-podcast")}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${
                mode === "per-podcast"
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background text-foreground border-border hover:bg-muted"
              }`}
            >
              Podcastonként a legnépszerűbb
            </button>
          </div>
        </header>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Még nincs adat.</p>
        ) : (
          <>
            {/* Podium */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {topThree.map((r, i) => (
                <Link
                  key={r.episode_id}
                  to={`/podcast/${r.podcast_slug}/${r.episode_slug}`}
                  className="group rounded-xl border bg-card hover:bg-muted/40 transition overflow-hidden"
                >
                  <div className="aspect-video relative bg-muted">
                    {r.youtube_video_id ? (
                      <img
                        src={`https://i.ytimg.com/vi/${r.youtube_video_id}/hqdefault.jpg`}
                        alt={r.episode_title}
                        className="w-full h-full object-cover"
                        loading={i === 0 ? "eager" : "lazy"}
                      />
                    ) : (
                      <img
                        src={r.episode_image || r.podcast_image || ""}
                        alt={r.episode_title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    )}
                    <div className="absolute top-2 left-2 bg-background/95 backdrop-blur rounded-full px-2.5 py-1 text-xs font-semibold flex items-center gap-1">
                      <Trophy className="h-3 w-3" /> #{i + 1}
                    </div>
                  </div>
                  <div className="p-3 space-y-1">
                    <p className="text-xs text-muted-foreground line-clamp-1">{r.podcast_title}</p>
                    <p className="text-sm font-medium line-clamp-2 group-hover:underline">{r.episode_title}</p>
                  </div>
                </Link>
              ))}
            </div>

            {/* List */}
            <ol className="space-y-2">
              {rows.slice(3).map((r, idx) => {
                const rank = idx + 4;
                return (
                  <li key={r.episode_id}>
                    <Link
                      to={`/podcast/${r.podcast_slug}/${r.episode_slug}`}
                      className="flex items-center gap-3 sm:gap-4 p-3 rounded-lg border hover:bg-muted/40 transition"
                    >
                      <div className="w-8 text-right text-sm font-semibold text-muted-foreground tabular-nums">
                        {rank}
                      </div>
                      <div className="shrink-0 w-14 h-14 rounded-md overflow-hidden bg-muted">
                        {r.youtube_video_id ? (
                          <img
                            src={`https://i.ytimg.com/vi/${r.youtube_video_id}/default.jpg`}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <img
                            src={r.episode_image || r.podcast_image || ""}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium line-clamp-1">{r.episode_title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {r.podcast_title}
                          {r.rank_label ? <span className="ml-2 opacity-70">· {r.rank_label}</span> : null}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>

          </>
        )}
      </div>
    </Layout>
  );
}
