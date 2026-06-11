import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Trend = {
  id: string;
  keyword: string;
  rank: number | null;
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
    podcasts: { slug: string; title: string; display_title: string | null; image_url: string | null } | null;
  } | null;
};

type EpItem = {
  id: string;
  title: string;
  slug: string;
  cover: string | null;
  podSlug: string;
  podTitle: string;
  keyword: string;
};

function trendHref(t: Trend): string {
  if (t.resolved_kind === "person" && t.resolved_person?.slug) return `/szemelyek/${t.resolved_person.slug}`;
  if (t.resolved_kind === "organization" && t.resolved_organization?.slug) return `/ceg/${t.resolved_organization.slug}`;
  return `/kereses?q=${encodeURIComponent(t.keyword)}`;
}

export function HeroTrendsStrip() {
  const [trends, setTrends] = useState<Trend[]>([]);
  const [eps, setEps] = useState<Record<string, EpRow[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: tData } = await supabase
        .from("daily_trends")
        .select(
          "id,keyword,rank,resolved_kind,resolved_person:people!daily_trends_resolved_person_id_fkey(slug,name),resolved_organization:organizations!daily_trends_resolved_organization_id_fkey(slug,name)"
        )
        .eq("is_active", true)
        .order("rank", { ascending: true, nullsFirst: false })
        .limit(10);
      const tr = (tData || []) as unknown as Trend[];
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

  const visibleTrends = useMemo(
    () => trends.filter((t) => (eps[t.id] || []).length > 0),
    [trends, eps]
  );

  const episodeItems = useMemo<EpItem[]>(() => {
    const items: EpItem[] = [];
    for (const t of visibleTrends) {
      for (const r of eps[t.id] || []) {
        const ep = r.episodes;
        if (!ep || !ep.podcasts) continue;
        items.push({
          id: ep.id,
          title: ep.display_title || ep.title,
          slug: ep.slug,
          cover: ep.image_url || ep.podcasts.image_url,
          podSlug: ep.podcasts.slug,
          podTitle: ep.podcasts.display_title || ep.podcasts.title,
          keyword: t.keyword,
        });
      }
    }
    return items;
  }, [visibleTrends, eps]);

  if (loading || visibleTrends.length === 0) return null;

  const trendsLoop = [...visibleTrends, ...visibleTrends];
  const epsLoop = [...episodeItems, ...episodeItems];

  return (
    <div className="space-y-1.5 py-3 border-y border-border/60 bg-background">
      {/* Row 1: keywords */}
      <div className="marquee-mask -mx-1">
        <div className="marquee-track marquee-slow flex items-center gap-2 px-1">
          {trendsLoop.map((t, i) => (
            <Link
              key={`${t.id}-${i}`}
              to={trendHref(t)}
              title={
                t.resolved_kind === "person"
                  ? `${t.resolved_person?.name ?? t.keyword} oldala`
                  : t.resolved_kind === "organization"
                    ? `${t.resolved_organization?.name ?? t.keyword} oldala`
                    : `Keresés: ${t.keyword}`
              }
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 hover:bg-primary/20 text-primary px-3 py-1 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
            >
              <span className="text-[10px] tabular-nums opacity-70">
                {String(t.rank ?? "·").padStart(2, "0")}
              </span>
              #{t.keyword}
            </Link>
          ))}
        </div>
      </div>

      {/* Row 2: episodes */}
      <div className="marquee-mask -mx-1">
        <div className="marquee-track marquee-slower marquee-reverse flex items-center gap-2 px-1">
          {epsLoop.map((ep, i) => (
            <Link
              key={`${ep.id}-${i}`}
              to={`/podcast/${ep.podSlug}/${ep.slug}`}
              title={`${ep.title} · ${ep.podTitle}`}
              className="group inline-flex items-center gap-2 max-w-[260px] rounded-full border border-border/70 bg-card/60 hover:bg-card hover:border-primary/50 pl-1 pr-3 py-1 shrink-0 transition-colors"
            >
              {ep.cover ? (
                <img
                  src={ep.cover}
                  alt=""
                  loading="lazy"
                  className="h-6 w-6 rounded-full object-cover shrink-0 ring-1 ring-border/60"
                />
              ) : (
                <span className="h-6 w-6 rounded-full bg-muted shrink-0 inline-flex items-center justify-center">
                  <Play className="h-3 w-3 text-muted-foreground" />
                </span>
              )}
              <span className="text-xs font-medium truncate group-hover:text-primary">
                {ep.title}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
