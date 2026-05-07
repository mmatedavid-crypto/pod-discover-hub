import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { Search } from "lucide-react";
import { setSeo } from "@/lib/seo";
import { searchEpisodes, parseQuery, normalizeQuery, MATCH_LABEL } from "@/lib/search";

type SortKey = "best" | "newest" | "rank";

const EXAMPLES = [
  "AI healthcare",
  "Italy food",
  "testosterone sleep",
  "asparagus cooking",
  "Nvidia data centers",
];

function escapeIlike(s: string) { return s.replace(/[%,_]/g, " ").replace(/[(),]/g, " "); }

function scorePodcast(p: any, terms: string[]): number {
  let s = 0;
  const title = (p.title || "").toLowerCase();
  const summary = (p.summary || "").toLowerCase();
  const desc = (p.description || "").toLowerCase();
  const cat = (p.category || "").toLowerCase();
  terms.forEach((term) => {
    const t = term.toLowerCase();
    if (title === t) s += 50;
    if (title.includes(t)) s += 25;
    if (cat.includes(t)) s += 8;
    if (summary.includes(t)) s += 6;
    if (desc.includes(t)) s += 3;
  });
  return s;
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get("q") || "";
  const sortParam = (params.get("sort") as SortKey) || "best";
  const catParam = params.get("cat") || "";
  const [q, setQ] = useState(initial);
  const [podcasts, setPodcasts] = useState<PodcastLite[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [broadened, setBroadened] = useState(false);
  const [semanticUsed, setSemanticUsed] = useState(false);
  const [suggestion, setSuggestion] = useState<string>("");
  const lastLoggedRef = useRef<string>("");

  useEffect(() => { setQ(initial); }, [initial]);

  useEffect(() => {
    setSeo({
      title: initial ? `${initial} — Podiverzum episode search` : "Search podcast episodes — Podiverzum",
      description: initial
        ? `Podcast episodes matching "${initial}". Search by topic, person, company, ticker or ingredient.`
        : "Search podcast episodes by topic, person, company, ticker or ingredient.",
      noindex: !initial,
    });
    setBroadened(false);
    setSemanticUsed(false);
    setSuggestion("");
    if (!initial) { setPodcasts([]); setEpisodes([]); return; }

    setLoading(true);
    (async () => {
      const result = await searchEpisodes({ rawQuery: initial, scope: "all", limit: 80 });
      if (result.suggestion && result.suggestion.toLowerCase() !== initial.toLowerCase()) setSuggestion(result.suggestion);
      setBroadened(result.fallbackUsed);
      setSemanticUsed(result.semanticUsed);

      let chosen = result.all;
      if (catParam) chosen = chosen.filter((x) => (x.e.podcasts?.category || "") === catParam);

      const ranked =
        sortParam === "newest"
          ? chosen.slice().sort((a: any, b: any) => new Date(b.e.published_at || 0).getTime() - new Date(a.e.published_at || 0).getTime()).slice(0, 80)
          : sortParam === "rank"
          ? chosen.slice().sort((a: any, b: any) => (b.e.episode_rank || 0) - (a.e.episode_rank || 0)).slice(0, 80)
          : chosen.slice(0, 80); // "best" — preserve diversity-aware order from searchEpisodes()
      const mapped: EpisodeLite[] = ranked.map((x) => ({ ...x.e, matchBadge: MATCH_LABEL[x.matchType] || "matched result" }));
      setEpisodes(mapped);
      setCategories(Array.from(new Set(ranked.map((x) => x.e.podcasts?.category).filter(Boolean) as string[])));

      if (lastLoggedRef.current !== initial) {
        lastLoggedRef.current = initial;
        const { data: sess } = await supabase.auth.getSession();
        const { terms } = parseQuery(normalizeQuery(initial).normalized || initial);
        supabase.from("search_events").insert({
          query: initial.slice(0, 200),
          terms_count: terms.length,
          result_count: mapped.length,
          fallback_used: result.fallbackUsed || result.semanticUsed,
          viewport_width: typeof window !== "undefined" ? window.innerWidth : null,
          user_id: sess.session?.user.id || null,
        }).then(() => {}, () => {});
      }

      // Podcasts query (separate, simpler).
      const { terms } = parseQuery(normalizeQuery(initial).normalized || initial);
      let pq = supabase
        .from("podcasts")
        .select(id,title,display_title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,rss_status,podiverzum_rank")
        .limit(60);
      terms.forEach((t) => {
        const v = `%${escapeIlike(t)}%`;
        pq = pq.or([`title.ilike.${v}`, `description.ilike.${v}`, `summary.ilike.${v}`, `category.ilike.${v}`].join(","));
      });
      const { data: ps } = await pq;
      const visiblePs = (ps || []).filter((p: any) => p.featured || (p.rss_status !== "failed" && p.rss_status !== "inactive"));
      const rankedPs = visiblePs
        .map((p) => ({ p, s: scorePodcast(p, terms) + ((p.podiverzum_rank ?? 0) * 0.5) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 18)
        .map((x) => x.p);
      setPodcasts(rankedPs);
      setLoading(false);
    })();
  }, [initial, sortParam, catParam]);

  const flatTerms = useMemo(() => parseQuery(initial).terms, [initial]);

  const setSort = (s: SortKey) => {
    const next = new URLSearchParams(params);
    next.set("q", initial); next.set("sort", s);
    if (catParam) next.set("cat", catParam);
    setParams(next);
  };
  const setCat = (c: string) => {
    const next = new URLSearchParams(params);
    next.set("q", initial);
    if (sortParam) next.set("sort", sortParam);
    if (c) next.set("cat", c); else next.delete("cat");
    setParams(next);
  };

  return (
    <Layout>
      <div className="container mx-auto py-10">
        <h1 className="text-3xl font-semibold mb-2">Search episodes</h1>
        <p className="text-muted-foreground mb-4 text-sm">
          Type words separated by spaces, e.g. <em>Italy food</em>. Use <code className="px-1 bg-secondary rounded">+</code> to require all terms strictly.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); setParams({ q }); }} className="relative max-w-2xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Italy food"
            className="w-full pl-10 pr-24 py-3 rounded-md bg-card border border-border focus:border-accent outline-none"
          />
          <button className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm">
            Search
          </button>
        </form>

        <div className="flex flex-wrap gap-2 mt-3">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => { setQ(ex); setParams({ q: ex }); }}
              className="px-3 py-1 rounded-full bg-secondary text-xs hover:bg-accent hover:text-accent-foreground"
            >
              {ex}
            </button>
          ))}
        </div>

        {initial && (
          <div className="flex flex-wrap gap-2 items-center mt-6 text-xs">
            <span className="text-muted-foreground">Sort:</span>
            {([
              ["best", "Best match"],
              ["newest", "Newest"],
              ["rank", "Highest episode rank"],
            ] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={`px-2.5 py-1 rounded-full border ${sortParam === k ? "bg-foreground text-background border-foreground" : "bg-card border-border hover:border-foreground/40"}`}
              >
                {l}
              </button>
            ))}
            {categories.length > 1 && (
              <>
                <span className="text-muted-foreground ml-2">Category:</span>
                <button onClick={() => setCat("")} className={`px-2.5 py-1 rounded-full border ${!catParam ? "bg-foreground text-background border-foreground" : "bg-card border-border hover:border-foreground/40"}`}>All</button>
                {categories.slice(0, 8).map((c) => (
                  <button key={c} onClick={() => setCat(c)} className={`px-2.5 py-1 rounded-full border ${catParam === c ? "bg-foreground text-background border-foreground" : "bg-card border-border hover:border-foreground/40"}`}>{c}</button>
                ))}
              </>
            )}
          </div>
        )}

        {initial && !loading && podcasts.length === 0 && episodes.length === 0 && (
          <div className="mt-10 p-6 border border-border rounded-lg bg-card text-sm text-muted-foreground">
            No exact episode matches yet.{suggestion && suggestion.toLowerCase() !== initial.toLowerCase() && (<> Did you mean <button onClick={() => { setQ(suggestion); setParams({ q: suggestion }); }} className="underline text-foreground font-medium">{suggestion}</button>?</>)} Try a broader search or <Link to="/categories" className="underline text-foreground">browse categories</Link>.
          </div>
        )}

        {initial && (podcasts.length > 0 || episodes.length > 0) && (
          <div className="mt-8 space-y-10">
            <section>
              <h2 className="font-semibold mb-3 flex items-center gap-2 flex-wrap">
                Matching episodes ({episodes.length})
                {suggestion && suggestion.toLowerCase() !== initial.toLowerCase() && (
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                    Showing results for {suggestion}
                  </span>
                )}
                {semanticUsed && (
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-primary/10 border border-primary/30 text-foreground/70">
                    including related ideas
                  </span>
                )}
                {broadened && !semanticUsed && (
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                    Showing broader matches
                  </span>
                )}
              </h2>
              <EpisodeList items={episodes} terms={flatTerms} showEntities />
            </section>
            {podcasts.length > 0 && (
              <section>
                <h2 className="font-semibold mb-3">Matching podcasts ({podcasts.length})</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {podcasts.map((p) => <PodcastCard key={p.id} p={p} />)}
                </div>
              </section>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-10">
          Indexed from public RSS feeds. Ranked by query relevance, freshness, feed health and Podiverzum Rank.
        </p>
      </div>
    </Layout>
  );
}
