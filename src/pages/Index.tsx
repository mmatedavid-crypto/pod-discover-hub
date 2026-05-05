import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { PodcastCover } from "@/components/PodcastCover";
import { Search, ArrowRight, Apple, Music, Youtube, Globe } from "lucide-react";
import { setSeo } from "@/lib/seo";

type Category = { id: string; name: string; slug: string; description: string | null };

type Podcast = PodcastLite & { featured?: boolean; featured_rank?: number | null; podiverzum_rank?: number };

const Index = () => {
  const [q, setQ] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [allPodcasts, setAllPodcasts] = useState<Podcast[]>([]);
  const [recentEpCounts, setRecentEpCounts] = useState<Record<string, { count: number; latest: number }>>({});
  const nav = useNavigate();

  useEffect(() => {
    setSeo({
      title: "Podiverzum — Podcast discovery & search",
      description: "Search the world of podcasts. Find episodes by topic, person, company, ticker, ingredient or idea.",
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
        .select("id,title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,featured_rank,rss_status")
        .order("featured", { ascending: false })
        .order("featured_rank", { ascending: true, nullsFirst: false })
        .limit(500);
      setAllPodcasts(((ps || []) as Podcast[]).filter((p: any) =>
        p.featured || (p.rss_status !== "failed" && p.rss_status !== "inactive")
      ));

      const { data: eps } = await supabase
        .from("episodes")
        .select("podcast_id,published_at")
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(1000);
      const map: Record<string, { count: number; latest: number }> = {};
      (eps || []).forEach((e: any) => {
        const t = e.published_at ? new Date(e.published_at).getTime() : 0;
        const cur = map[e.podcast_id] || { count: 0, latest: 0 };
        cur.count++;
        if (t > cur.latest) cur.latest = t;
        map[e.podcast_id] = cur;
      });
      setRecentEpCounts(map);
    })();
  }, []);

  const visiblePodcasts = useMemo(
    () => allPodcasts.filter((p: any) => p.featured || (recentEpCounts[p.id]?.count || 0) > 0),
    [allPodcasts, recentEpCounts],
  );

  const trending = useMemo(() => {
    const now = Date.now();
    const scored = visiblePodcasts.map((p) => {
      const stats = recentEpCounts[p.id] || { count: 0, latest: 0 };
      const featured = p.featured ? 50 : 0;
      const rankBoost = p.featured && p.featured_rank ? Math.max(0, 10 - p.featured_rank) : 0;
      const epCount = Math.min(stats.count, 30);
      const ageDays = stats.latest ? (now - stats.latest) / 86400000 : 999;
      const recency = stats.latest ? Math.max(0, 30 - ageDays) : 0;
      return { p, score: featured + rankBoost + epCount + recency };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 10).map((s) => s.p);
  }, [visiblePodcasts, recentEpCounts]);

  const byCat = useMemo(() => {
    const grouped: Record<string, Podcast[]> = {};
    visiblePodcasts.forEach((p) => {
      if (!p.category) return;
      (grouped[p.category] ||= []).push(p);
    });
    return grouped;
  }, [visiblePodcasts]);

  return (
    <Layout>
      <section className="border-b border-border">
        <div className="container mx-auto py-12 sm:py-20">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight max-w-3xl">
            Search the world of podcasts.
          </h1>
          <p className="text-muted-foreground mt-3 max-w-2xl">
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
        </div>
      </section>

      <div className="container mx-auto py-10 space-y-12">
        {trending.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-4">
              <h2 className="text-xl font-semibold">Trending now</h2>
              <span className="text-xs text-muted-foreground">Across all categories</span>
            </div>
            <ol className="divide-y divide-border border border-border rounded-lg bg-card">
              {trending.map((p, i) => (
                <li key={p.id} className="p-3 flex gap-3 items-start">
                  <div className="w-8 shrink-0 text-2xl font-semibold text-muted-foreground tabular-nums text-right">
                    {i + 1}
                  </div>
                  <Link to={`/podcast/${p.slug}`} className="shrink-0 w-16">
                    <PodcastCover title={p.title} src={p.image_url} size="sm" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link to={`/podcast/${p.slug}`} className="font-medium hover:underline line-clamp-1">{p.title}</Link>
                    {p.category && <div className="text-xs text-muted-foreground">{p.category}</div>}
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{p.summary || p.description}</p>
                    <div className="flex gap-2 mt-1.5 text-muted-foreground">
                      {p.apple_url && <a href={p.apple_url} target="_blank" rel="noreferrer" aria-label="Apple"><Apple className="h-4 w-4 hover:text-foreground" /></a>}
                      {p.spotify_url && <a href={p.spotify_url} target="_blank" rel="noreferrer" aria-label="Spotify"><Music className="h-4 w-4 hover:text-foreground" /></a>}
                      {p.youtube_url && <a href={p.youtube_url} target="_blank" rel="noreferrer" aria-label="YouTube"><Youtube className="h-4 w-4 hover:text-foreground" /></a>}
                      {p.website_url && <a href={p.website_url} target="_blank" rel="noreferrer" aria-label="Website"><Globe className="h-4 w-4 hover:text-foreground" /></a>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {cats.filter((c) => c.slug !== "trending").map((c) => {
          const items = byCat[c.name]?.slice(0, 10) || [];
          if (!items.length) return null;
          return (
            <section key={c.id}>
              <div className="flex items-end justify-between mb-4">
                <h2 className="text-xl font-semibold">{c.name}</h2>
                <Link to={`/category/${c.slug}`} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  See all <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((p) => <PodcastCard key={p.id} p={p} />)}
              </div>
            </section>
          );
        })}
        {!Object.keys(byCat).length && (
          <div className="text-center py-20 text-muted-foreground">
            No podcasts yet. <Link to="/admin" className="underline">Add some in admin</Link>.
          </div>
        )}
      </div>
    </Layout>
  );
};

export default Index;
