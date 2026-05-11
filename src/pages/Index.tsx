import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { Search, ArrowRight, Sparkles } from "lucide-react";
import { setSeo } from "@/lib/seo";
import { compareByScore } from "@/lib/episodeRank";
import { MoodCollections } from "@/components/MoodCollections";
import { Skeleton } from "@/components/Skeletons";
import { ContinueListening } from "@/components/ContinueListening";
import { RecentlyAddedPodcasts } from "@/components/RecentlyAddedPodcasts";
import { TrendingEntities } from "@/components/TrendingEntities";
import { topEntitiesFrom } from "@/lib/aggregateEntities";


type Category = { id: string; name: string; slug: string; description: string | null };

const HOMEPAGE_EPISODE_LIMIT = 240;

type FeedEpisode = EpisodeLite & { freshness_bucket?: "hot" | "fresh" | "recent" };

const Index = () => {
  const [q, setQ] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [podcasts, setPodcasts] = useState<(PodcastLite & { podiverzum_rank?: number; featured?: boolean })[]>([]);
  const [trendingEps, setTrendingEps] = useState<FeedEpisode[]>([]);
  const [allEps, setAllEps] = useState<FeedEpisode[]>([]);
  const [evergreenEps, setEvergreenEps] = useState<EpisodeLite[]>([]);
  const [trendingEntityEps, setTrendingEntityEps] = useState<EpisodeLite[]>([]);
  const [chips, setChips] = useState<{ label: string; query: string }[]>([
    { label: "AI healthcare", query: "AI healthcare" },
    { label: "Warren Buffett", query: "Warren Buffett" },
    { label: "testosterone sleep", query: "testosterone sleep" },
    { label: "Nvidia data centers", query: "Nvidia data centers" },
    { label: "asparagus cooking", query: "asparagus cooking" },
  ]);
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "search_suggestions")
      .maybeSingle()
      .then(({ data }) => {
        const items = (data?.value as any)?.items;
        if (Array.isArray(items) && items.length) {
          setChips(items.filter((c) => c?.label && c?.query).slice(0, 8));
        }
      });
  }, []);

  useEffect(() => {
    setSeo({
      title: "Podiverzum — Podcast episode discovery & search",
      description: "Search podcast episodes by topic, person, company, ticker, ingredient or idea.",
      hreflang: [
        { lang: "en", href: "https://podiverzum.com/" },
        { lang: "hu", href: "https://podiverzum.com/hu" },
        { lang: "x-default", href: "https://podiverzum.com/" },
      ],
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
      try {
        const [catsRes, feedRes, evergreenRes, podsRes] = await Promise.all([
          supabase.from("categories").select("*").order("sort_order"),
          supabase
            .from("mv_homepage_feed" as any)
            .select("episode_id,title,display_title,slug,summary,description,published_at,audio_url,topics,podcast_id,podcast_slug,podcast_title,podcast_display_title,podcast_image_url,podcast_category,podiverzum_rank,rank_label,rss_status,featured,featured_rank,pod_rank,freshness_bucket")
            .lte("pod_rank", 6)
            .order("published_at", { ascending: false, nullsFirst: false })
            .limit(HOMEPAGE_EPISODE_LIMIT),
          supabase
            .from("mv_homepage_evergreen" as any)
            .select("episode_id,title,display_title,slug,summary,description,ai_summary,published_at,audio_url,topics,podcast_id,podcast_slug,podcast_title,podcast_display_title,podcast_image_url,podcast_category,podiverzum_rank,rank_label,rss_status,featured")
            .order("podiverzum_rank", { ascending: false, nullsFirst: false })
            .limit(40),
          supabase
            .from("podcasts")
            .select("id,title,display_title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,featured_rank,rss_status,podiverzum_rank,rank_label,shadow_rank_components")
            .or("featured.eq.true,rank_label.in.(S,A)")
            .not("rss_status", "in", "(failed,inactive)")
            .order("featured", { ascending: false })
            .order("podiverzum_rank", { ascending: false })
            .limit(40),
        ]);

        setCats(catsRes.data || []);

        const goodHealth = (p: any) => {
          const hs = (p.shadow_rank_components as any)?.health_state;
          return !hs || hs === "healthy" || hs === "recovered_rss_url";
        };
        const eligible = (podsRes.data || []).filter((p: any) =>
          p.featured || (["S", "A"].includes(p.rank_label) && goodHealth(p))
        );
        setPodcasts(eligible);

        const mapRow = (r: any): FeedEpisode => ({
          id: r.episode_id,
          title: r.title,
          display_title: r.display_title,
          slug: r.slug,
          summary: r.summary,
          description: r.description,
          published_at: r.published_at,
          audio_url: r.audio_url,
          topics: r.topics,
          freshness_bucket: r.freshness_bucket,
          podcasts: {
            slug: r.podcast_slug,
            title: r.podcast_title,
            display_title: r.podcast_display_title,
            image_url: r.podcast_image_url,
            category: r.podcast_category,
            podiverzum_rank: r.podiverzum_rank,
            rank_label: r.rank_label,
            rss_status: r.rss_status,
            featured: r.featured,
          } as any,
        });

        const eps: FeedEpisode[] = (feedRes.data || []).map(mapRow);

        // Trending = last 14 days (hot+fresh). Fall back to recent (≤30d) if <8 items.
        const hotFresh = eps.filter((e) => e.freshness_bucket === "hot" || e.freshness_bucket === "fresh");
        const trendingPool = hotFresh.length >= 8 ? hotFresh : eps;
        // Diversify: max 2 episodes per podcast in the trending strip so one show
        // can't dominate. Spillover is appended after if we run short of 8 items.
        const sorted = trendingPool.slice().sort(compareByScore);
        const PER_PODCAST_CAP = 2;
        const counts = new Map<string, number>();
        const primary: FeedEpisode[] = [];
        const overflow: FeedEpisode[] = [];
        for (const e of sorted) {
          const key = (e.podcasts as any)?.slug || (e.podcasts as any)?.title || "_";
          const n = counts.get(key) || 0;
          if (n < PER_PODCAST_CAP) { primary.push(e); counts.set(key, n + 1); }
          else overflow.push(e);
        }
        setTrendingEps([...primary, ...overflow].slice(0, 8));
        setAllEps(eps);

        // Evergreen v0: S-tier, AI-summarized, >30 days old. Diverse by podcast.
        const evergreen: EpisodeLite[] = (evergreenRes.data || []).map(mapRow);
        setEvergreenEps(evergreen.slice(0, 6));
      } catch (err) {
        console.error("Index load failed", err);
        setLoadError(true);
      } finally {
        setLoaded(true);
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
      const sorted = grouped[k].sort(compareByScore);
      // Same per-podcast cap as trending: max 2 per show within a category strip.
      const counts = new Map<string, number>();
      const primary: EpisodeLite[] = [];
      const overflow: EpisodeLite[] = [];
      for (const e of sorted) {
        const key = (e.podcasts as any)?.slug || (e.podcasts as any)?.title || "_";
        const n = counts.get(key) || 0;
        if (n < 2) { primary.push(e); counts.set(key, n + 1); }
        else overflow.push(e);
      }
      grouped[k] = [...primary, ...overflow].slice(0, 6);
    });
    return grouped;
  }, [allEps]);

  return (
    <Layout>
      
      <section className="bg-background text-foreground relative border-b border-border overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-background" />
        {/* Brand spotlight */}
        <div aria-hidden className="pointer-events-none absolute inset-0 hero-spot" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-background" />
        <div className="relative container mx-auto py-20 sm:py-32">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 backdrop-blur text-[10px] uppercase tracking-[0.22em] text-primary shadow-sm animate-fade-up">
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="pulse-red" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            Live · Episode-first discovery
          </div>
          <h1 className="text-5xl sm:text-7xl font-bold tracking-tight max-w-4xl mt-6 leading-[1.02] animate-fade-up">
            <span className="text-foreground">Find it.</span>{" "}
            <span className="text-brand-gradient">Hear it.</span>
          </h1>
          <p className="text-muted-foreground mt-6 max-w-2xl text-base sm:text-lg leading-relaxed animate-fade-up">
            Podiverzum searches the world of podcasts — by topic, person, company, ticker,
            ingredient or idea. Premium discovery for serious listeners.
          </p>
          <form
            onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`); }}
            className="mt-10 max-w-2xl relative focus-brand rounded-2xl transition-shadow animate-fade-up"
          >
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Try: AI healthcare, Nvidia data centers, Italy food…"
              className="w-full pl-12 pr-32 py-4 rounded-2xl bg-card/80 backdrop-blur border border-border focus:border-primary/50 outline-none text-base placeholder:text-muted-foreground/60 shadow-elevated"
            />
            <button className="btn-brand absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2 rounded-xl text-sm font-semibold">
              Search
            </button>
          </form>
          <div className="mt-5 flex flex-wrap gap-2">
            {chips.map((c) => (
              <button key={c.label} type="button" onClick={() => nav(`/search?q=${encodeURIComponent(c.query)}`)} className="chip">
                {c.label}
              </button>
            ))}
          </div>
        </div>
        {/* bottom rule */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      </section>

      <div className="container mx-auto py-12 space-y-14">
        <ContinueListening />
        {/* Mood shelf — above trending on desktop, below on mobile */}
        <div className="hidden md:block">
          <MoodCollections />
        </div>
        {!loaded && trendingEps.length === 0 && (
          <section>
            <Skeleton className="h-6 w-48 mb-4" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3 p-4 border border-border/50 rounded-xl">
                  <Skeleton className="h-16 w-16 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-5/6" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

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

        {/* Mood shelf — mobile position (below trending) */}
        <div className="md:hidden">
          <MoodCollections />
        </div>

        {cats.filter((c) => c.slug !== "trending").map((c, idx) => {
          const items = epsByCat[c.name] || [];
          if (!items.length) return null;
          const tinted = idx % 2 === 1;
          return (
            <section key={c.id} className={tinted ? "rounded-2xl bg-card/40 border border-border/60 p-5 sm:p-6" : ""}>
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

        {evergreenEps.length > 0 && (
          <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card/40 to-card/40 p-5 sm:p-6">
            <div className="flex items-end justify-between mb-4">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary/90 mb-1">
                  <Sparkles className="h-3 w-3" /> Timeless
                </div>
                <h2 className="text-xl sm:text-2xl font-semibold">Timeless episodes</h2>
                <p className="text-xs text-muted-foreground mt-1">Older episodes from S-tier podcasts that still hold up.</p>
              </div>
            </div>
            <EpisodeList items={evergreenEps} />
          </section>
        )}

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

        <RecentlyAddedPodcasts limit={6} />

        {loaded && !trendingEps.length && !topPodcasts.length && (
          <div className="text-center py-20 text-muted-foreground">
            {loadError
              ? "Episodes are temporarily unavailable. Please refresh shortly."
              : "Featured episodes are temporarily unavailable."}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default Index;
