import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Trend = {
  id: string;
  keyword: string;
  rank: number | null;
  traffic: string | null;
};

type EpRow = {
  trend_id: string;
  rank: number;
  episodes: {
    id: string;
    title: string;
    display_title: string | null;
    slug: string;
    image_url: string | null;
    podcasts: { slug: string; title: string; display_title: string | null; image_url: string | null } | null;
  } | null;
};

export function DailyTrendsSection() {
  const [trends, setTrends] = useState<Trend[]>([]);
  const [eps, setEps] = useState<Record<string, EpRow[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: tData } = await supabase
        .from("daily_trends")
        .select("id,keyword,rank,traffic")
        .eq("is_active", true)
        .order("rank", { ascending: true, nullsFirst: false })
        .limit(10);
      const tr = (tData || []) as Trend[];
      setTrends(tr);
      if (tr.length) {
        const { data: mData } = await supabase
          .from("daily_trend_episodes")
          .select(
            "trend_id,rank,episodes!inner(id,title,display_title,slug,image_url,podcasts!inner(slug,title,display_title,image_url))"
          )
          .in("trend_id", tr.map((t) => t.id))
          .order("rank", { ascending: true });
        const grouped: Record<string, EpRow[]> = {};
        for (const r of (mData || []) as any[]) {
          (grouped[r.trend_id] ||= []).push(r as EpRow);
        }
        setEps(grouped);
      }
      setLoading(false);
    })();
  }, []);

  const visible = useMemo(
    () => trends.filter((t) => (eps[t.id] || []).length > 0),
    [trends, eps]
  );

  if (loading || visible.length === 0) return null;

  return (
    <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card/50 to-card/30 overflow-hidden">
      <header className="px-5 sm:px-6 pt-5 pb-3 border-b border-border/60">
        <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-primary mb-1 font-semibold">
          <TrendingUp className="h-3.5 w-3.5" /> Napi trendek · Magyarország
        </div>
        <h2 className="text-xl sm:text-2xl font-semibold">Miről beszél ma a világ?</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Google Trends top kulcsszavak — mellettük az adatbázisunk releváns epizódjai.
        </p>
      </header>

      <ul className="divide-y divide-border/50">
        {visible.map((t) => {
          const rows = eps[t.id] || [];
          return (
            <li
              key={t.id}
              className="group flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3 hover:bg-card/60 transition-colors"
            >
              {/* Rank + keyword */}
              <div className="flex items-center gap-2.5 shrink-0 w-[34%] sm:w-[28%] min-w-0">
                <span className="text-[10px] tabular-nums font-mono text-muted-foreground w-4 text-right">
                  {String(t.rank ?? "·").padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                    #{t.keyword}
                  </div>
                  {t.traffic && (
                    <div className="text-[10px] text-muted-foreground tabular-nums truncate">
                      {t.traffic}
                    </div>
                  )}
                </div>
              </div>

              {/* Episode ticker */}
              <div className="flex-1 min-w-0 overflow-x-auto scrollbar-none">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  {rows.map((r) => {
                    if (!r.episodes) return null;
                    const ep = r.episodes;
                    const cover = ep.image_url || ep.podcasts?.image_url;
                    const pod = ep.podcasts?.display_title || ep.podcasts?.title || "";
                    const title = ep.display_title || ep.title;
                    return (
                      <Link
                        key={ep.id}
                        to={`/podcast/${ep.podcasts?.slug}/${ep.slug}`}
                        title={`${title} · ${pod}`}
                        className="group/ep inline-flex items-center gap-2 max-w-[220px] sm:max-w-[260px] rounded-full border border-border/70 bg-background/70 hover:bg-background hover:border-primary/50 pl-1 pr-3 py-1 shrink-0 transition-colors"
                      >
                        {cover ? (
                          <img
                            src={cover}
                            alt=""
                            loading="lazy"
                            className="h-6 w-6 rounded-full object-cover shrink-0 ring-1 ring-border/60"
                          />
                        ) : (
                          <span className="h-6 w-6 rounded-full bg-muted shrink-0 inline-flex items-center justify-center">
                            <Play className="h-3 w-3 text-muted-foreground" />
                          </span>
                        )}
                        <span className="text-xs font-medium truncate group-hover/ep:text-primary">
                          {title}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
