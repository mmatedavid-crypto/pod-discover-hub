import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, Play, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { setSeo } from "@/lib/seo";

type Trend = {
  id: string;
  keyword: string;
  rank: number | null;
  traffic: string | null;
  resolved_kind: string | null;
  resolved_person: { slug: string; name: string } | null;
  resolved_organization: { slug: string; name: string } | null;
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
    published_at: string | null;
    podcasts: { slug: string; title: string; display_title: string | null; image_url: string | null } | null;
  } | null;
};

function trendHref(t: Trend): string {
  if (t.resolved_kind === "person" && t.resolved_person?.slug) return `/szemelyek/${t.resolved_person.slug}`;
  if (t.resolved_kind === "organization" && t.resolved_organization?.slug) return `/ceg/${t.resolved_organization.slug}`;
  return `/kereses?q=${encodeURIComponent(t.keyword)}`;
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "";
  try {
    return new Date(s).toLocaleDateString("hu-HU", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export default function TrendsPage() {
  const [trends, setTrends] = useState<Trend[]>([]);
  const [eps, setEps] = useState<Record<string, EpRow[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSeo({
      title: "Miről beszél ma az ország? · Podiverzum",
      description:
        "A Google Trends mai magyar kulcsszavai — minden trendhez a katalógusunk leginkább releváns epizódjai.",
      canonical: "https://podiverzum.hu/trendek",
      robots: "noindex, follow",
    });
  }, []);

  useEffect(() => {
    (async () => {
      const { data: tData } = await supabase
        .from("daily_trends")
        .select(
          "id,keyword,rank,traffic,resolved_kind,resolved_person:people!daily_trends_resolved_person_id_fkey(slug,name),resolved_organization:organizations!daily_trends_resolved_organization_id_fkey(slug,name)"
        )
        .eq("is_active", true)
        .order("rank", { ascending: true, nullsFirst: false })
        .limit(20);
      const tr = (tData || []) as unknown as Trend[];
      setTrends(tr);
      if (tr.length) {
        const { data: mData } = await supabase
          .from("daily_trend_episodes")
          .select(
            "trend_id,rank,episodes!inner(id,title,display_title,slug,image_url,published_at,podcasts!inner(slug,title,display_title,image_url))"
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

  const visibleTrends = trends.filter((t) => (eps[t.id] || []).length > 0);

  return (
    <main className="container mx-auto px-4 py-8 sm:py-12 max-w-4xl">
      <header className="mb-8 sm:mb-10">
        <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-primary font-semibold mb-2">
          <TrendingUp className="h-3.5 w-3.5" /> Napi trendek · Magyarország
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Miről beszél ma az ország?</h1>
        <p className="mt-2 text-muted-foreground max-w-2xl">
          A Google Trends által ma kiemelt magyar témák, mellettük a katalógusunkból kiválasztott
          legrelevánsabb podcast-epizódok. Csak azok a trendek látszanak, amelyekre van legalább egy releváns
          felvétel.
        </p>
      </header>

      {/* Top strip: all keywords */}
      {!loading && visibleTrends.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-10 pb-6 border-b border-border/60">
          {visibleTrends.map((t) => (
            <Link
              key={t.id}
              to={trendHref(t)}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 hover:bg-primary/20 text-primary px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors"
            >
              <span className="text-[10px] tabular-nums opacity-70">
                {String(t.rank ?? "·").padStart(2, "0")}
              </span>
              #{t.keyword}
            </Link>
          ))}
        </div>
      )}

      {loading && <p className="text-muted-foreground">Betöltés…</p>}
      {!loading && visibleTrends.length === 0 && (
        <p className="text-muted-foreground">Most nincs aktív trend, amihez epizódot is társítottunk.</p>
      )}

      <div className="space-y-10">
        {visibleTrends.map((t) => {
          const list = eps[t.id] || [];
          return (
            <section key={t.id} id={`t-${t.id}`}>
              <div className="flex items-baseline gap-3 mb-3 flex-wrap">
                <h2 className="text-xl sm:text-2xl font-semibold">
                  <Link to={trendHref(t)} className="hover:text-primary transition-colors">
                    #{t.keyword}
                  </Link>
                </h2>
                {t.traffic && (
                  <span className="text-xs text-muted-foreground tabular-nums">{t.traffic}</span>
                )}
                <Link
                  to={`/kereses?q=${encodeURIComponent(t.keyword)}`}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                >
                  <Search className="h-3.5 w-3.5" /> Összes találat
                </Link>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {list.map((r) => {
                  const ep = r.episodes;
                  if (!ep || !ep.podcasts) return null;
                  return (
                    <li key={ep.id}>
                      <Link
                        to={`/podcast/${ep.podcasts.slug}/${ep.slug}`}
                        className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card/50 hover:bg-card hover:border-primary/40 p-3 transition-colors"
                      >
                        {ep.image_url || ep.podcasts.image_url ? (
                          <img
                            src={ep.image_url || ep.podcasts.image_url || ""}
                            alt=""
                            loading="lazy"
                            className="h-12 w-12 rounded-md object-cover shrink-0 ring-1 ring-border/60"
                          />
                        ) : (
                          <span className="h-12 w-12 rounded-md bg-muted shrink-0 inline-flex items-center justify-center">
                            <Play className="h-4 w-4 text-muted-foreground" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate group-hover:text-primary">
                            {ep.display_title || ep.title}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {ep.podcasts.display_title || ep.podcasts.title}
                            {ep.published_at ? ` · ${fmtDate(ep.published_at)}` : ""}
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
