import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { setSeo } from "@/lib/seo";
import NotFoundState from "@/components/NotFoundState";
import { Search } from "lucide-react";
import { searchEpisodes, MATCH_LABEL, SearchScope } from "@/lib/search";

export default function CategoryDetail() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const queryParam = params.get("q") || "";
  const scopeParam = (params.get("scope") as SearchScope) || "category";

  const [cat, setCat] = useState<any>(null);
  const [podcasts, setPodcasts] = useState<PodcastLite[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeLite[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Search state
  const [q, setQ] = useState(queryParam);
  const [searchLoading, setSearchLoading] = useState(false);
  const [inCat, setInCat] = useState<EpisodeLite[]>([]);
  const [outside, setOutside] = useState<EpisodeLite[]>([]);
  const [allResults, setAllResults] = useState<EpisodeLite[]>([]);
  const [semanticUsed, setSemanticUsed] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  useEffect(() => { setQ(queryParam); }, [queryParam]);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      const { data: c } = await supabase.from("categories").select("*").eq("slug", slug).maybeSingle();
      setCat(c);
      setLoading(false);
      if (!c) return;
      setSeo({
        title: `${c.name} podcast episodes — Podiverzum`,
        description: `Discover the latest podcast episodes in ${c.name}, ranked by relevance, freshness and Podiverzum Rank.`,
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: `${c.name} podcast episodes`,
          about: { "@type": "Thing", name: c.name },
          url: typeof window !== "undefined" ? window.location.href : undefined,
        },
      });
      const { data: ps } = await supabase
        .from("podcasts")
        .select("id,title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,rss_status,podiverzum_rank")
        .eq("category", c.name)
        .order("featured", { ascending: false })
        .order("podiverzum_rank", { ascending: false })
        .limit(60);
      const visible = (ps || []).filter((p: any) => p.featured || (p.rss_status !== "failed" && p.rss_status !== "inactive"));
      const ids0 = visible.map((p: any) => p.id);
      const epCountMap: Record<string, number> = {};
      if (ids0.length) {
        const { data: ec } = await supabase.from("episodes").select("podcast_id").in("podcast_id", ids0);
        (ec || []).forEach((e: any) => { epCountMap[e.podcast_id] = (epCountMap[e.podcast_id] || 0) + 1; });
      }
      const high = visible.filter((p: any) => p.featured || ((p.podiverzum_rank ?? 1) >= 6 && (epCountMap[p.id] || 0) > 0));
      const mid = visible.filter((p: any) => !p.featured && (p.podiverzum_rank ?? 1) >= 4 && (p.podiverzum_rank ?? 1) < 6 && (epCountMap[p.id] || 0) > 0);
      const promotedPodcasts = (high.length >= 6 ? high : [...high, ...mid]).slice(0, 12);
      setPodcasts(promotedPodcasts);

      const promotedIds = promotedPodcasts.map((p: any) => p.id);
      if (promotedIds.length) {
        const { data: eps } = await supabase
          .from("episodes")
          .select("id,title,slug,summary,description,published_at,audio_url,episode_rank,topics,podcasts!inner(slug,title,image_url,category,podiverzum_rank)")
          .in("podcast_id", promotedIds)
          .order("episode_rank", { ascending: false })
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(40);
        const sorted = (eps || []).slice().sort((a: any, b: any) => {
          const ar = a.episode_rank ?? 0, br = b.episode_rank ?? 0;
          if (br !== ar) return br - ar;
          const at = a.published_at ? new Date(a.published_at).getTime() : 0;
          const bt = b.published_at ? new Date(b.published_at).getTime() : 0;
          if (bt !== at) return bt - at;
          return (b.podcasts?.podiverzum_rank ?? 0) - (a.podcasts?.podiverzum_rank ?? 0);
        }).slice(0, 25);
        setEpisodes(sorted as any);
        const t = new Map<string, number>();
        (sorted || []).forEach((e: any) => (e.topics || []).forEach((x: string) => t.set(x, (t.get(x) || 0) + 1)));
        setTopics([...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k));
      }
    })();
  }, [slug]);

  // Run query-time search when there is a query.
  useEffect(() => {
    if (!cat || !queryParam) {
      setInCat([]); setOutside([]); setAllResults([]); setSemanticUsed(false); setSuggestion(null);
      return;
    }
    setSearchLoading(true);
    (async () => {
      const r = await searchEpisodes({ rawQuery: queryParam, scope: scopeParam, categoryName: cat.name, limit: 60 });
      setSemanticUsed(r.semanticUsed);
      setSuggestion(r.suggestion);
      const decorate = (arr: any[]) => arr.map((x) => ({ ...x.e, matchBadge: MATCH_LABEL[x.matchType] })) as EpisodeLite[];
      setInCat(decorate(r.inCategory));
      setOutside(decorate(r.outsideCategory));
      setAllResults(decorate(r.all));
      setSearchLoading(false);
    })();
  }, [cat, queryParam, scopeParam]);

  const flatTerms = useMemo(() => queryParam.trim().split(/\s+/).filter((t) => t.length >= 2), [queryParam]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (q.trim()) next.set("q", q.trim()); else next.delete("q");
    if (!next.has("scope")) next.set("scope", "category");
    setParams(next);
  };
  const setScope = (s: SearchScope) => {
    const next = new URLSearchParams(params);
    next.set("scope", s);
    if (queryParam) next.set("q", queryParam);
    setParams(next);
  };

  if (loading) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!cat) return <NotFoundState title="Category not found" message="That category doesn't exist or has been removed." />;

  return (
    <Layout>
      <div className="container mx-auto py-10">
        <h1 className="text-3xl font-semibold">{cat.name}</h1>
        <p className="text-muted-foreground mt-1">
          Latest podcast episodes in {cat.name}, ranked by relevance, freshness and Podiverzum Rank.
        </p>

        {/* Category-scoped search */}
        <form onSubmit={submitSearch} className="relative max-w-2xl mt-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search in ${cat.name}…`}
            className="w-full pl-10 pr-24 py-3 rounded-md bg-card border border-border focus:border-accent outline-none"
          />
          <button className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm">
            Search
          </button>
        </form>
        <div className="flex flex-wrap gap-2 items-center mt-3 text-xs">
          <span className="text-muted-foreground">Search scope:</span>
          {([["category", `This category`], ["all", "All Podiverzum"]] as const).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setScope(k)}
              className={`px-2.5 py-1 rounded-full border ${scopeParam === k ? "bg-foreground text-background border-foreground" : "bg-card border-border hover:border-foreground/40"}`}
            >
              {l}
            </button>
          ))}
        </div>

        {queryParam ? (
          <div className="mt-8 space-y-10">
            {searchLoading && <div className="text-sm text-muted-foreground">Searching…</div>}

            {scopeParam === "category" && (
              <>
                <section>
                  <h2 className="font-semibold mb-3 flex items-center gap-2 flex-wrap">
                    Best matches in {cat.name} ({inCat.length})
                    {suggestion && suggestion.toLowerCase() !== queryParam.toLowerCase() && (
                      <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                        Showing results for {suggestion}
                      </span>
                    )}
                    {semanticUsed && (
                      <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-mint/15 border border-mint/30 text-foreground/70">
                        including related ideas
                      </span>
                    )}
                  </h2>
                  {inCat.length > 0 ? (
                    <EpisodeList items={inCat} terms={flatTerms} showEntities />
                  ) : (
                    <div className="p-6 border border-border rounded-lg bg-card text-sm text-muted-foreground">
                      No matches in {cat.name}. Try “All Podiverzum” to broaden the search.
                    </div>
                  )}
                </section>
                {outside.length > 0 && (
                  <section>
                    <h2 className="font-semibold mb-3 flex items-center gap-2 flex-wrap">
                      Strong matches outside {cat.name} ({outside.length})
                      <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                        outside this category
                      </span>
                    </h2>
                    <EpisodeList items={outside} terms={flatTerms} showEntities />
                  </section>
                )}
              </>
            )}

            {scopeParam === "all" && (
              <section>
                <h2 className="font-semibold mb-3 flex items-center gap-2 flex-wrap">
                  Matching episodes ({allResults.length})
                  {suggestion && suggestion.toLowerCase() !== queryParam.toLowerCase() && (
                    <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                      Showing results for {suggestion}
                    </span>
                  )}
                  {semanticUsed && (
                    <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-mint/15 border border-mint/30 text-foreground/70">
                      including related ideas
                    </span>
                  )}
                </h2>
                <EpisodeList items={allResults} terms={flatTerms} showEntities />
              </section>
            )}
          </div>
        ) : (
          <>
            <h2 className="text-xl font-semibold mt-10 mb-4">Latest episodes in {cat.name}</h2>
            {episodes.length > 0 ? (
              <EpisodeList items={episodes} showTopics />
            ) : (
              <div className="p-6 border border-border rounded-lg bg-card text-sm text-muted-foreground">
                No episodes indexed in this category yet. Podiverzum is still growing automatically.
              </div>
            )}

            {topics.length > 0 && (
              <>
                <h2 className="text-xl font-semibold mt-10 mb-3">Popular topics</h2>
                <div className="flex flex-wrap gap-2">
                  {topics.map((t) => (
                    <Link key={t} to={`/topic/${encodeURIComponent(t.toLowerCase().replace(/[^a-z0-9]+/g,"-"))}`} className="px-3 py-1 rounded-full bg-secondary text-sm hover:bg-accent hover:text-accent-foreground">
                      {t}
                    </Link>
                  ))}
                </div>
              </>
            )}

            {podcasts.length > 0 && (
              <>
                <h2 className="text-xl font-semibold mt-10 mb-4">Top podcasts in {cat.name}</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {podcasts.map((p) => <PodcastCard key={p.id} p={p} />)}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
