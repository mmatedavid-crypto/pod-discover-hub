import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { Search, ArrowRight } from "lucide-react";
import { setSeo } from "@/lib/seo";

type Category = { id: string; name: string; slug: string; description: string | null };

const Index = () => {
  const [q, setQ] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [podcasts, setPodcasts] = useState<(PodcastLite & { podiverzum_rank?: number; featured?: boolean })[]>([]);
  const [trendingEps, setTrendingEps] = useState<EpisodeLite[]>([]);
  const [allEps, setAllEps] = useState<EpisodeLite[]>([]);
  const nav = useNavigate();

  useEffect(() => {
    setSeo({
      title: "Podiverzum — Podcast episode discovery & search",
      description: "Search podcast episodes by topic, person, company, ticker, ingredient or idea.",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Podiverzum",
        url: "https://podiverzum.com",
        potentialAction: {
          "@type": "SearchAction",
          target: "https://podiverzum.com/search?q={search_term_string}",
          "query-input": "required name=search_term_string",
        },
      },
    });
    (async () => {
      const { data: c } = await supabase.from("categories").select("*").order("sort_order");
      setCats(c || []);

      const { data: ps } = await supabase
        .from("podcasts")
        .select("id,title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,featured_rank,rss_status,podiverzum_rank")
        .order("featured", { ascending: false })
        .order("podiverzum_rank", { ascending: false })
        .limit(500);
      const eligible = (ps || []).filter((p: any) =>
        p.featured || ((p.podiverzum_rank ?? 1) >= 6 && p.rss_status !== "failed" && p.rss_status !== "inactive")
      );
      setPodcasts(eligible);

      const eligibleIds = eligible.map((p: any) => p.id);
      if (eligibleIds.length) {
        const { data: eps } = await supabase
          .from("episodes")
          .select("id,title,slug,summary,description,published_at,audio_url,episode_rank,topics,podcasts!inner(slug,title,image_url,category,podiverzum_rank,rss_status,featured)")
          .in("podcast_id", eligibleIds)
          .order("episode_rank", { ascending: false })
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(400);
        const sortFn = (a: any, b: any) => {
          const ar = a.episode_rank ?? 0, br = b.episode_rank ?? 0;
          if (br !== ar) return br - ar;
          const at = a.published_at ? new Date(a.published_at).getTime() : 0;
          const bt = b.published_at ? new Date(b.published_at).getTime() : 0;
          if (bt !== at) return bt - at;
          return (b.podcasts?.podiverzum_rank ?? 0) - (a.podcasts?.podiverzum_rank ?? 0);
        };
        setTrendingEps(((eps || []).slice().sort(sortFn).slice(0, 12)) as any);
        setAllEps((eps || []) as any);
      }
    })();
  }, []);

  const topPodcasts = useMemo(() => podcasts.slice(0, 12), [podcasts]);

  const epsByCat = useMemo(() => {
    const grouped: Record<string, EpisodeLite[]> = {};
    allEps.forEach((e) => {
      const cat = e.podcasts?.category;
      if (!cat) return;
      (grouped[cat] ||= []).push(e);
    });
    Object.keys(grouped).forEach((k) => {
      grouped[k] = grouped[k].sort((a: any, b: any) => {
        const ar = a.episode_rank ?? 0, br = b.episode_rank ?? 0;
        if (br !== ar) return br - ar;
        const at = a.published_at ? new Date(a.published_at).getTime() : 0;
        const bt = b.published_at ? new Date(b.published_at).getTime() : 0;
        if (bt !== at) return bt - at;
        return (b.podcasts?.podiverzum_rank ?? 0) - (a.podcasts?.podiverzum_rank ?? 0);
      }).slice(0, 6);
    });
    return grouped;
  }, [allEps]);

  return (
    <Layout>
      <section className="relative border-b border-border overflow-hidden">
        {/* Ambient glow */}
        <div aria-hidden className="pointer-events-none absolute inset-0 hero-glow opacity-90" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-background" />
        <div className="relative container mx-auto py-16 sm:py-28">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-card/80 backdrop-blur text-[11px] uppercase tracking-[0.18em] text-muted-foreground shadow-sm">
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping motion-reduce:hidden" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Episode-first podcast discovery
          </div>
          <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight max-w-3xl mt-6 leading-[1.04]">
            Search the world<br className="hidden sm:block" /> of podcasts.
          </h1>
          <p className="text-muted-foreground mt-5 max-w-2xl text-base sm:text-lg leading-relaxed">
            Find podcast episodes by topic, person, company, ticker, ingredient or idea.
          </p>
          <form
            onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`); }}
            className="mt-8 max-w-2xl relative focus-mint rounded-xl transition-shadow"
          >
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Try: AI + healthcare"
              className="w-full pl-12 pr-28 py-4 rounded-xl bg-card border border-border focus:border-foreground outline-none text-base shadow-[0_1px_2px_hsl(0_0%_0%/0.04),0_8px_24px_-12px_hsl(0_0%_0%/0.08)]"
            />
            <button className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all">
              Search
            </button>
          </form>
          <div className="mt-5 flex flex-wrap gap-2">
            {["AI + healthcare","Warren Buffett + Occidental","testosterone + sleep","asparagus + cooking","Nvidia + data centers"].map((ex) => (
              <button key={ex} type="button" onClick={() => nav(`/search?q=${encodeURIComponent(ex)}`)} className="chip">
                {ex}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="container mx-auto py-12 space-y-14">
        {trendingEps.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">Editor's pulse</div>
                <h2 className="text-2xl font-semibold">Trending episodes</h2>
              </div>
              <span className="text-xs text-muted-foreground">Ranked by relevance &amp; freshness</span>
            </div>
            <EpisodeList items={trendingEps} />
          </section>
        )}

        {cats.filter((c) => c.slug !== "trending").map((c, idx) => {
          const items = epsByCat[c.name] || [];
          if (!items.length) return null;
          const tinted = idx % 2 === 1;
          return (
            <section key={c.id} className={tinted ? "rounded-2xl bg-secondary/40 border border-border/60 p-5 sm:p-6" : ""}>
              <div className="flex items-end justify-between mb-1">
                <h2 className="text-xl sm:text-2xl font-semibold">{c.name}</h2>
                <Link to={`/category/${c.slug}`} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  See more episodes <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <p className="text-xs text-muted-foreground mb-4">Latest episodes in {c.name}</p>
              <EpisodeList items={items} />
            </section>
          );
        })}

        {topPodcasts.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">Quality first</div>
                <h2 className="text-xl sm:text-2xl font-semibold">High-rank podcasts</h2>
              </div>
              <Link to="/categories" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                Browse all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {topPodcasts.map((p) => <PodcastCard key={p.id} p={p} />)}
            </div>
          </section>
        )}

        {!trendingEps.length && !topPodcasts.length && (
          <div className="text-center py-20 text-muted-foreground">
            No episodes yet. <Link to="/admin" className="underline">Add some in admin</Link>.
          </div>
        )}
      </div>
    </Layout>
  );
};

export default Index;
