import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { setSeo } from "@/lib/seo";
import { compareByScore } from "@/lib/episodeRank";
import { Calendar, Sparkles, Clock } from "lucide-react";
import { TrendingEntities } from "@/components/TrendingEntities";
import { topEntitiesFrom } from "@/lib/aggregateEntities";

type Row = any;

function mapRow(r: Row): EpisodeLite {
  return {
    id: r.id,
    title: r.title,
    display_title: r.display_title,
    slug: r.slug,
    ai_summary: r.ai_summary,
    summary: r.summary,
    description: r.description,
    published_at: r.published_at,
    audio_url: r.audio_url,
    topics: r.topics,
    people: r.people,
    companies: r.companies,
    podcasts: {
      slug: r.podcasts?.slug,
      title: r.podcasts?.title,
      display_title: r.podcasts?.display_title,
      image_url: r.podcasts?.image_url,
      category: r.podcasts?.category,
      podiverzum_rank: r.podcasts?.podiverzum_rank,
      // @ts-expect-error extra fields used by sort
      rank_label: r.podcasts?.rank_label,
      // @ts-expect-error extra fields used by filter
      rss_status: r.podcasts?.rss_status,
    },
  };
}

const PRETTY_DATE = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric",
});

export default function DailyBriefPage() {
  const [eps, setEps] = useState<EpisodeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [windowHours, setWindowHours] = useState<24 | 48 | 72>(24);

  useEffect(() => {
    setSeo({
      title: "Daily Brief — fresh podcast episodes today | Podiverzum",
      description: "The best podcast episodes published in the last 24-72 hours, hand-ranked by Podiverzum.",
    });
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 72 * 3600_000).toISOString();
      const { data } = await supabase
        .from("episodes")
        .select(`id,title,display_title,slug,ai_summary,summary,description,published_at,audio_url,topics,people,companies,podcasts!inner(slug,title,display_title,image_url,category,podiverzum_rank,rank_label,rss_status,language)`)
        .gte("published_at", since)
        .in("podcasts.rank_label", ["S", "A", "B"])
        .or("language.is.null,language.ilike.en%", { foreignTable: "podcasts" })
        .not("podcasts.rss_status", "in", "(failed,inactive)")
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(400);

      const mapped = (data || []).map(mapRow);
      setEps(mapped);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const cutoff = Date.now() - windowHours * 3600_000;
    return eps.filter((e) => e.published_at && new Date(e.published_at).getTime() >= cutoff);
  }, [eps, windowHours]);

  const ranked = useMemo(() => filtered.slice().sort(compareByScore), [filtered]);

  // Diverse top — max 1 per podcast for the hero "Top 5"
  const top5 = useMemo(() => {
    const seen = new Set<string>();
    const out: EpisodeLite[] = [];
    for (const e of ranked) {
      const key = e.podcasts?.slug || "_";
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
      if (out.length >= 5) break;
    }
    return out;
  }, [ranked]);

  const restByCategory = useMemo(() => {
    const grouped: Record<string, EpisodeLite[]> = {};
    const seenIds = new Set(top5.map((e) => e.id));
    for (const e of ranked) {
      if (seenIds.has(e.id)) continue;
      const cat = e.podcasts?.category || "More";
      (grouped[cat] ||= []).push(e);
    }
    return Object.entries(grouped)
      .map(([cat, list]) => ({ cat, list: list.slice(0, 6) }))
      .sort((a, b) => b.list.length - a.list.length);
  }, [ranked, top5]);

  const today = PRETTY_DATE.format(new Date());
  const topTopics = useMemo(() => topEntitiesFrom(eps, "topics", "topic", 8), [eps]);
  const topPeople = useMemo(() => topEntitiesFrom(eps, "people", "person", 8), [eps]);

  return (
    <Layout>
      {/* Hero */}
      <section className="border-b border-border bg-background relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 hero-spot opacity-60" />
        <div className="container mx-auto py-12 sm:py-16 relative">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-[10px] uppercase tracking-[0.22em] text-primary">
            <Calendar className="h-3 w-3" /> Daily Brief
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mt-4 leading-[1.05]">
            What's worth hearing <span className="text-brand-gradient">today</span>
          </h1>
          <p className="text-muted-foreground mt-3 max-w-2xl">
            {today} · The best podcast episodes published recently across S/A-tier shows. Curated by Podiverzum, refreshed continuously.
          </p>

          <div className="mt-6 inline-flex rounded-lg border border-border bg-card overflow-hidden text-sm">
            {([24, 48, 72] as const).map((h) => (
              <button
                key={h}
                onClick={() => setWindowHours(h)}
                className={`px-3 py-1.5 transition-colors ${
                  windowHours === h
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Last {h}h
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="container mx-auto py-10 space-y-12">
        {loading && <div className="text-muted-foreground py-10 text-center">Loading today's brief…</div>}

        {!loading && top5.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            No fresh episodes in the last {windowHours}h. Try a wider window.
          </div>
        )}

        {top5.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-4">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary mb-1">
                  <Sparkles className="h-3 w-3" /> Top 5 right now
                </div>
                <h2 className="text-2xl font-semibold">If you only have time for five</h2>
                <p className="text-xs text-muted-foreground mt-1">One per show. Ranked by tier, freshness and Podiverzum Rank.</p>
              </div>
            </div>
            <EpisodeList items={top5} />
          </section>
        )}

        {topTopics.length > 0 && (
          <TrendingEntities
            eyebrow="Today's signal"
            title="What's getting talked about"
            subtitle="Topics surfacing across today's episodes."
            items={topTopics}
            icon="topic"
          />
        )}

        {topPeople.length > 0 && (
          <TrendingEntities
            eyebrow="People in today's brief"
            title="Names you'll hear today"
            items={topPeople}
            icon="person"
          />
        )}

        {restByCategory.map(({ cat, list }, idx) => (
          <section key={cat} className={idx % 2 === 1 ? "rounded-2xl bg-card/40 border border-border/60 p-5 sm:p-6" : ""}>
            <div className="flex items-end justify-between mb-3">
              <h2 className="text-xl font-semibold inline-flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" /> {cat}
              </h2>
              <span className="text-xs text-muted-foreground">{list.length} episode{list.length === 1 ? "" : "s"}</span>
            </div>
            <EpisodeList items={list} />
          </section>
        ))}

        <div className="text-center pt-6">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to home</Link>
        </div>
      </div>
    </Layout>
  );
}
