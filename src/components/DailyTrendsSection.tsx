import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, ChevronDown, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Trend = {
  id: string;
  keyword: string;
  rank: number | null;
  traffic: string | null;
  related_queries: string[] | null;
};

type MatchEp = {
  trend_id: string;
  rank: number;
  episodes: {
    id: string;
    title: string;
    display_title: string | null;
    slug: string;
    image_url: string | null;
    ai_summary: string | null;
    summary: string | null;
    podcasts: { slug: string; title: string; display_title: string | null } | null;
  } | null;
};

export function DailyTrendsSection() {
  const [trends, setTrends] = useState<Trend[]>([]);
  const [matches, setMatches] = useState<Record<string, MatchEp[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: tData } = await supabase
        .from("daily_trends")
        .select("id,keyword,rank,traffic,related_queries")
        .eq("is_active", true)
        .order("rank", { ascending: true, nullsFirst: false })
        .limit(10);
      const tr = (tData || []) as Trend[];
      setTrends(tr);
      if (tr.length) {
        const ids = tr.map((t) => t.id);
        const { data: mData } = await supabase
          .from("daily_trend_episodes")
          .select(
            "trend_id,rank,episodes!inner(id,title,display_title,slug,image_url,ai_summary,summary,podcasts!inner(slug,title,display_title))"
          )
          .in("trend_id", ids)
          .order("rank", { ascending: true });
        const grouped: Record<string, MatchEp[]> = {};
        for (const r of (mData || []) as any[]) {
          (grouped[r.trend_id] ||= []).push(r as MatchEp);
        }
        setMatches(grouped);
      }
      setLoading(false);
    })();
  }, []);

  const visible = useMemo(() => trends.filter((t) => t.keyword), [trends]);

  if (loading || visible.length === 0) return null;

  return (
    <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card/50 to-card/30 p-5 sm:p-6">
      <div className="mb-4">
        <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-primary mb-1 font-semibold">
          <TrendingUp className="h-3.5 w-3.5" /> Napi trendek · Magyarország
        </div>
        <h2 className="text-xl sm:text-2xl font-semibold">Miről beszél ma a világ?</h2>
        <p className="text-xs text-muted-foreground mt-1">
          A Google Trends által ma kiemelt magyar témák — hozzájuk kapcsolva a katalógusunk leginkább releváns epizódjai.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {visible.map((t) => {
          const isOpen = open === t.id;
          const eps = matches[t.id] || [];
          return (
            <button
              key={t.id}
              onClick={() => setOpen(isOpen ? null : t.id)}
              className={cn(
                "group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                isOpen
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card/70 hover:border-primary/50 hover:bg-card"
              )}
            >
              <span className="font-medium">#{t.keyword}</span>
              {t.traffic && (
                <span className={cn("text-[10px] tabular-nums opacity-70", isOpen && "opacity-90")}>
                  {t.traffic}
                </span>
              )}
              {eps.length > 0 && (
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")}
                />
              )}
            </button>
          );
        })}
      </div>

      {open && (
        <div className="mt-5 rounded-xl border border-border/70 bg-background/60 p-4">
          {(matches[open] || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Még nincs releváns epizód ehhez a trendhez. Nézz vissza később!
            </p>
          ) : (
            <ul className="space-y-3">
              {(matches[open] || []).map((m) => {
                if (!m.episodes) return null;
                const ep = m.episodes;
                const podSlug = ep.podcasts?.slug;
                const podTitle = ep.podcasts?.display_title || ep.podcasts?.title || "";
                const epTitle = ep.display_title || ep.title;
                const desc = ep.ai_summary || ep.summary || "";
                return (
                  <li key={ep.id} className="flex gap-3">
                    {ep.image_url ? (
                      <img
                        src={ep.image_url}
                        alt=""
                        loading="lazy"
                        className="h-16 w-16 rounded-md object-cover shrink-0 bg-muted"
                      />
                    ) : (
                      <div className="h-16 w-16 rounded-md bg-muted shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/podcast/${podSlug}/${ep.slug}`}
                        className="block font-medium text-sm leading-snug hover:text-primary line-clamp-2"
                      >
                        {epTitle}
                      </Link>
                      <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {podTitle}
                      </div>
                      {desc && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{desc}</p>
                      )}
                    </div>
                    <Link
                      to={`/podcast/${podSlug}/${ep.slug}`}
                      aria-label="Lejátszás"
                      className="self-center shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <Play className="h-4 w-4" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
