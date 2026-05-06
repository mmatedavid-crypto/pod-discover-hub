import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { Search } from "lucide-react";
import { setSeo } from "@/lib/seo";

type SortKey = "best" | "newest" | "rank";

const EXAMPLES = [
  "AI healthcare",
  "Italy food",
  "testosterone sleep",
  "asparagus cooking",
  "Nvidia data centers",
];

const BUILTIN_SYNONYMS: Record<string, string[]> = {
  food: ["cooking", "cuisine", "restaurant", "restaurants", "dining"],
  italy: ["italian", "rome", "tuscany", "naples", "sicily"],
  ai: ["artificial intelligence", "machine learning"],
  healthcare: ["health care", "medicine", "medical"],
  "real estate": ["property", "housing"],
  investing: ["investment", "stocks"],
  "weight loss": ["obesity", "glp-1"],
  sleep: ["insomnia", "recovery"],
};

function uniq<T>(a: T[]) { return Array.from(new Set(a)); }

// strict=true when user typed an explicit "+" (strong AND intent).
function parseQuery(q: string): { terms: string[]; strict: boolean } {
  const strict = /\+/.test(q);
  const terms = q
    .split(/[+,&]|\s+and\s+|\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  return { terms: uniq(terms), strict };
}

async function expandTerm(term: string): Promise<string[]> {
  const t = term.toLowerCase();
  const out = new Set<string>([term]);
  if (BUILTIN_SYNONYMS[t]) BUILTIN_SYNONYMS[t].forEach((s) => out.add(s));
  for (const [k, vs] of Object.entries(BUILTIN_SYNONYMS)) {
    if (vs.includes(t)) { out.add(k); vs.forEach((v) => out.add(v)); }
  }
  const { data } = await supabase
    .from("search_synonyms")
    .select("term,synonyms")
    .or(`term.eq.${t},synonyms.cs.{${t}}`);
  (data || []).forEach((row: any) => {
    out.add(row.term);
    (row.synonyms || []).forEach((s: string) => out.add(s));
  });
  return Array.from(out);
}

function escapeIlike(s: string) {
  return s.replace(/[%,_]/g, " ").replace(/[(),]/g, " ");
}

function scorePodcast(p: any, termGroups: string[][]): number {
  let s = 0;
  const title = (p.title || "").toLowerCase();
  const summary = (p.summary || "").toLowerCase();
  const desc = (p.description || "").toLowerCase();
  const cat = (p.category || "").toLowerCase();
  termGroups.forEach((variants) => {
    const orig = variants[0].toLowerCase();
    if (title === orig) s += 50;
    if (title.includes(orig)) s += 25;
    if (variants.some((v) => title.includes(v.toLowerCase()))) s += 12;
    if (variants.some((v) => cat.includes(v.toLowerCase()))) s += 8;
    if (variants.some((v) => summary.includes(v.toLowerCase()))) s += 6;
    if (variants.some((v) => desc.includes(v.toLowerCase()))) s += 3;
  });
  return s;
}

function scoreEpisode(e: any, termGroups: string[][]): number {
  let s = 0;
  const title = (e.title || "").toLowerCase();
  const summary = (e.summary || "").toLowerCase();
  const desc = (e.description || "").toLowerCase();
  const arrays = [
    ...(e.topics || []), ...(e.people || []), ...(e.companies || []),
    ...(e.tickers || []), ...(e.ingredients || []),
  ].map((x: string) => x.toLowerCase());
  let allTermsHit = true;
  termGroups.forEach((variants) => {
    const lc = variants.map((v) => v.toLowerCase());
    const orig = lc[0];
    let hit = false;
    if (title === orig) { s += 250; hit = true; }
    if (title.includes(orig)) { s += 150; hit = true; }
    if (lc.some((v) => title.includes(v))) { s += 90; hit = true; }
    if (lc.some((v) => summary.includes(v) || desc.includes(v))) { s += 70; hit = true; }
    if (lc.some((v) => arrays.includes(v))) { s += 60; hit = true; }
    if (lc.some((v) => arrays.some((a) => a.includes(v)))) { s += 30; hit = true; }
    if (!hit) allTermsHit = false;
  });
  if (allTermsHit) s += 80;
  if (e.published_at) {
    const ageDays = (Date.now() - new Date(e.published_at).getTime()) / 86400000;
    s += Math.max(0, 30 - ageDays) * 0.6;
    if (ageDays < 7) s += 10;
    else if (ageDays < 30) s += 5;
  }
  s += ((e.episode_rank ?? 0)) * 1.2;
  s += ((e.podcasts?.podiverzum_rank ?? 0)) * 0.6;
  return s;
}

// Returns true when every term group has at least one hit somewhere in the episode.
function scoreEpisodeAllHit(e: any, termGroups: string[][]): boolean {
  const title = (e.title || "").toLowerCase();
  const summary = (e.summary || "").toLowerCase();
  const desc = (e.description || "").toLowerCase();
  const arrays = [
    ...(e.topics || []), ...(e.people || []), ...(e.companies || []),
    ...(e.tickers || []), ...(e.ingredients || []),
  ].map((x: string) => x.toLowerCase());
  return termGroups.every((variants) => {
    const lc = variants.map((v) => v.toLowerCase());
    return lc.some((v) =>
      title.includes(v) || summary.includes(v) || desc.includes(v) ||
      arrays.some((a) => a.includes(v))
    );
  });
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
    if (!initial) { setPodcasts([]); setEpisodes([]); return; }
    const { terms, strict } = parseQuery(initial);
    if (!terms.length) return;
    setLoading(true);
    (async () => {
      const termGroups = await Promise.all(terms.map(expandTerm));

      let eq = supabase
        .from("episodes")
        .select("id,title,slug,published_at,summary,description,topics,people,companies,tickers,ingredients,audio_url,episode_rank,podcast_id,podcasts!inner(slug,title,image_url,category,podiverzum_rank,rss_status)")
        .limit(300);
      termGroups.forEach((variants) => {
        const ors: string[] = [];
        uniq<string>(variants).forEach((t) => {
          const v = `%${escapeIlike(t)}%`;
          ors.push(`title.ilike.${v}`, `description.ilike.${v}`, `summary.ilike.${v}`);
          ors.push(`topics.cs.{${t}}`, `people.cs.{${t}}`, `companies.cs.{${t}}`, `tickers.cs.{${t}}`, `ingredients.cs.{${t}}`);
        });
        eq = eq.or(ors.join(","));
      });
      const { data: es } = await eq;
      const allScored = (es || [])
        .map((e: any) => ({ e, s: scoreEpisode(e, termGroups), all: scoreEpisodeAllHit(e, termGroups) }))
        .filter((x) => x.s > 0);

      // Strict (explicit "+") OR multi-term: prefer episodes hitting all terms.
      let scored = allScored;
      let usedFallback = false;
      if (termGroups.length > 1) {
        const allHit = allScored.filter((x) => x.all);
        if (strict) {
          scored = allHit;
        } else if (allHit.length > 0) {
          scored = allHit;
        } else {
          scored = allScored;
          usedFallback = true;
        }
      }
      setBroadened(usedFallback);

      if (catParam) scored = scored.filter((x) => (x.e.podcasts?.category || "") === catParam);
      const sortFn =
        sortParam === "newest"
          ? (a: any, b: any) => new Date(b.e.published_at || 0).getTime() - new Date(a.e.published_at || 0).getTime()
          : sortParam === "rank"
          ? (a: any, b: any) => (b.e.episode_rank || 0) - (a.e.episode_rank || 0)
          : (a: any, b: any) => b.s - a.s;
      const rankedEs = scored.sort(sortFn).slice(0, 80).map((x) => x.e);
      setEpisodes(rankedEs as any);
      setCategories(uniq<string>(rankedEs.map((e: any) => e.podcasts?.category).filter(Boolean) as string[]));

      let pq = supabase
        .from("podcasts")
        .select("id,title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,rss_status,podiverzum_rank")
        .limit(60);
      termGroups.forEach((variants) => {
        const ors = uniq<string>(variants).flatMap((t) => {
          const v = `%${escapeIlike(t)}%`;
          return [`title.ilike.${v}`, `description.ilike.${v}`, `summary.ilike.${v}`, `category.ilike.${v}`];
        }).join(",");
        pq = pq.or(ors);
      });
      const { data: ps } = await pq;
      const visiblePs = (ps || []).filter((p: any) =>
        p.featured || (p.rss_status !== "failed" && p.rss_status !== "inactive")
      );
      const rankedPs = visiblePs
        .map((p) => ({ p, s: scorePodcast(p, termGroups) + ((p.podiverzum_rank ?? 0) * 0.5) }))
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
          Use <code className="px-1 bg-secondary rounded">+</code> to combine ideas, e.g. <em>AI + healthcare</em>.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); setParams({ q }); }} className="relative max-w-2xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="AI + healthcare"
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
            No matching podcast episodes found yet. Try another keyword or <Link to="/categories" className="underline text-foreground">browse categories</Link>.
          </div>
        )}

        {initial && (podcasts.length > 0 || episodes.length > 0) && (
          <div className="mt-8 space-y-10">
            <section>
              <h2 className="font-semibold mb-3">Matching episodes ({episodes.length})</h2>
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
          Indexed from public RSS feeds. Ranked by freshness, feed health and episode relevance.
        </p>
      </div>
    </Layout>
  );
}
