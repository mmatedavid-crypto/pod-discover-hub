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
      <section className="border-b border-border bg-gradient-to-b from-secondary/40 to-background">
        <div className="container mx-auto py-14 sm:py-24">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-background/60 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
            Episode-first podcast discovery
          </div>
          <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight max-w-3xl mt-5 leading-[1.05]">
            Search the world of podcasts.
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl text-base sm:text-lg">
            Find podcast episodes by topic, person, company, ticker, ingredient or idea.
          </p>
          <form
            onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`); }}
            className="mt-8 max-w-2xl relative"
          >
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Try: stocks + Occidental, AI + healthcare, fitness + testosterone"
              className="w-full pl-12 pr-28 py-4 rounded-lg bg-card border border-border focus:border-foreground outline-none text-base"
            />
            <button className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
              Search
            </button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {["AI + healthcare","Warren Buffett + Occidental","testosterone + sleep","asparagus + cooking","Nvidia + data centers"].map((ex) => (
              <button key={ex} type="button" onClick={() => nav(`/search?q=${encodeURIComponent(ex)}`)} className="px-3 py-1 rounded-full bg-secondary text-xs hover:bg-accent hover:text-accent-foreground">
                {ex}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="container mx-auto py-10 space-y-12">
        {trendingEps.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-4">
              <h2 className="text-xl font-semibold">Trending episodes</h2>
              <span className="text-xs text-muted-foreground">Ranked by relevance &amp; freshness</span>
            </div>
            <EpisodeList items={trendingEps} />
          </section>
        )}

        {cats.filter((c) => c.slug !== "trending").map((c) => {
          const items = epsByCat[c.name] || [];
          if (!items.length) return null;
          return (
            <section key={c.id}>
              <div className="flex items-end justify-between mb-1">
                <h2 className="text-xl font-semibold">{c.name}</h2>
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
              <h2 className="text-xl font-semibold">High-rank podcasts</h2>
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
