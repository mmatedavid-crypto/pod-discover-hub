import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { setSeo, breadcrumbJsonLd, ogImageUrl } from "@/lib/seo";
import { compareByScore } from "@/lib/episodeRank";
import { Sparkles, Clock } from "lucide-react";
import { TrendingEntities } from "@/components/TrendingEntities";
import { topEntitiesFrom } from "@/lib/aggregateEntities";
import NewspaperMasthead from "@/components/NewspaperMasthead";
import DailyEditorials from "@/components/DailyEditorials";
import DailyStatsStrip from "@/components/DailyStatsStrip";
import WeeklyEditorialStrip from "@/components/WeeklyEditorialStrip";
import { sitePublisherJsonLd } from "@/lib/sitePublisher";

type Row = any;

function mapRow(r: Row): EpisodeLite {
  return {
    id: r.id,
    title: r.title,
    display_title: r.display_title,
    slug: r.slug,
    image_url: r.image_url,
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
      rank_label: r.podcasts?.rank_label,
      rss_status: r.podcasts?.rss_status,
    } as any,
  };
}


export default function DailyBriefPage() {
  const [eps, setEps] = useState<EpisodeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [windowHours, setWindowHours] = useState<24 | 48 | 72>(24);

  useEffect(() => {
    setSeo({
      title: "Mai válogatás – friss magyar podcast epizódok | Podiverzum",
      description: "Friss podcast epizódok, témák és szereplők — minőség, aktualitás és relevancia alapján rendezve.",
      canonical: "https://podiverzum.hu/napi",
      ogType: "article",
      image: ogImageUrl({
        kind: "site",
        title: "Mai válogatás",
        subtitle: "Friss magyar podcast epizódok",
      }),
    });
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 72 * 3600_000).toISOString();
      const { data } = await supabase
        .from("episodes")
        .select(`id,title,display_title,slug,image_url,ai_summary,summary,description,published_at,audio_url,topics,people,companies,podcasts!inner(slug,title,display_title,image_url,category,podiverzum_rank,rank_label,rss_status,language,language_decision)`)
        .gte("published_at", since)
        .eq("podcasts.language_decision", "accept_hungarian")
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

  // Per-day NewsArticle + ItemList JSON-LD once the top picks are loaded
  useEffect(() => {
    if (!top5.length) return;
    const canonical = "https://podiverzum.hu/napi";
    const today = new Date().toISOString().slice(0, 10);
    const title = `Mai válogatás – ${today} | Podiverzum`;
    const description = `A nap ${top5.length} legjobb magyar podcast epizódja — minőség, aktualitás és relevancia alapján rendezve.`;
    const heroImage = top5[0]?.podcasts?.image_url || ogImageUrl({ kind: "site", title: "Mai válogatás", subtitle: today });
    setSeo({
      title,
      description,
      canonical,
      ogType: "article",
      image: heroImage,
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "NewsArticle",
          headline: `Mai válogatás – friss magyar podcast epizódok (${today})`,
          description,
          url: canonical,
          mainEntityOfPage: canonical,
          inLanguage: "hu-HU",
          datePublished: new Date().toISOString(),
          dateModified: new Date().toISOString(),
          image: [heroImage],
          articleSection: "Napi válogatás",
          author: {
            "@type": "Organization",
            name: "Podiverzum szerkesztőség",
            url: "https://podiverzum.hu",
          },
          publisher: sitePublisherJsonLd(),
        },
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "Mai top epizódok",
          itemListElement: top5.map((e, idx) => ({
            "@type": "ListItem",
            position: idx + 1,
            url: `https://podiverzum.hu/podcast/${e.podcasts?.slug}/${e.slug}`,
            name: e.display_title || e.title,
          })),
        },
        breadcrumbJsonLd([
          { name: "Podiverzum", url: "https://podiverzum.hu/" },
          { name: "Mai válogatás", url: canonical },
        ]),
      ],
    });
  }, [top5]);

  const restByCategory = useMemo(() => {
    const grouped: Record<string, EpisodeLite[]> = {};
    const seenIds = new Set(top5.map((e) => e.id));
    for (const e of ranked) {
      if (seenIds.has(e.id)) continue;
      const cat = e.podcasts?.category || "Egyéb";
      (grouped[cat] ||= []).push(e);
    }
    return Object.entries(grouped)
      .map(([cat, list]) => ({ cat, list: list.slice(0, 6) }))
      .sort((a, b) => b.list.length - a.list.length);
  }, [ranked, top5]);

  const topTopics: ReturnType<typeof topEntitiesFrom> = []; // 2026-06-13: nyers topics megbízhatatlan; lecserélés topic_clusters-re folyamatban.
  const topPeople = useMemo(() => topEntitiesFrom(eps, "people", "person", 8), [eps]);

  return (
    <Layout>
      {/* A nap idézete — legfelül, kiemelve */}
      <section className="bg-card/30 border-b border-border">
        <div className="container mx-auto py-6">
          <DailyEditorials />
        </div>
      </section>

      {/* Hero — internetes híroldal stílus */}
      <section className="bg-background border-b border-border">
        <div className="container mx-auto pt-8 sm:pt-10 pb-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary font-semibold">
            Mai válogatás
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1.5">
            Friss magyar podcast epizódok
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
            Új epizódok, témák és szereplők — minőség, aktualitás és relevancia alapján.
          </p>
        </div>
        <NewspaperMasthead />
        <div className="container mx-auto py-3 flex justify-end">
          <div className="inline-flex rounded-md border border-border bg-card overflow-hidden text-xs">
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
                Elmúlt {h}h
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="container mx-auto py-10 space-y-12">
        {/* Heti válogatás csík — egy hétig kiemelve */}
        <WeeklyEditorialStrip />

        {/* Stats strip */}
        <DailyStatsStrip />



        {loading && <div className="text-muted-foreground py-10 text-center">A mai válogatás betöltése…</div>}

        {!loading && top5.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            Nincs friss epizód az elmúlt {windowHours} órában. Válassz egy hosszabb időszakot.
          </div>
        )}

        {top5.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-4">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary mb-1">
                  <Sparkles className="h-3 w-3" /> {top5.length === 1 ? "A legfontosabb" : `A legfontosabb ${top5.length}`}
                </div>
                <h2 className="text-2xl font-semibold">
                  {top5.length >= 5
                    ? "Ha csak ötre van időd"
                    : top5.length === 1
                    ? "Ha csak egyre van időd"
                    : `Ha csak ${top5.length === 2 ? "kettőre" : top5.length === 3 ? "háromra" : "négyre"} van időd`}
                </h2>
                <p className="text-xs text-muted-foreground mt-1">Műsoronként egy epizód. Minősítés, frissesség és relevancia alapján.</p>
              </div>
            </div>
            <EpisodeList items={top5} />
          </section>
        )}

        {topTopics.length > 0 && (
          <TrendingEntities
            eyebrow="A nap témái"
            title="Miről beszélnek ma"
            subtitle="A mai epizódokban felbukkanó témák."
            items={topTopics}
            icon="topic"
          />
        )}

        {topPeople.length > 0 && (
          <TrendingEntities
            eyebrow="Személyek a mai válogatásban"
            title="Nevek, amiket ma hallasz"
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
              <span className="text-xs text-muted-foreground">{list.length} epizód</span>
            </div>
            <EpisodeList items={list} />
          </section>
        ))}

        <div className="text-center pt-6">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Vissza a kezdőlapra</Link>
        </div>
      </div>
    </Layout>
  );
}
