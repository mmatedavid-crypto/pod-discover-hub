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

// High-confidence synonyms only — keep ≤2 per term to avoid query blowup.
const BUILTIN_SYNONYMS: Record<string, string[]> = {
  food: ["cooking", "cuisine"],
  italy: ["italian", "rome"],
  ai: ["artificial intelligence", "machine learning"],
  healthcare: ["health", "medical"],
  "real estate": ["property", "housing"],
  investing: ["investment", "stocks"],
  "weight loss": ["obesity", "glp-1"],
  sleep: ["insomnia", "recovery"],
  testosterone: ["hormones"],
  nvidia: ["nvda"],
  dubai: ["uae"],
};

const EPISODE_SELECT =
  "id,title,slug,published_at,summary,description,topics,people,companies,tickers,ingredients,audio_url,episode_rank,podcast_id,podcasts!inner(slug,title,image_url,category,podiverzum_rank,rss_status)";

function uniq<T>(a: T[]) { return Array.from(new Set(a)); }

function parseQuery(q: string): { terms: string[]; strict: boolean } {
  const strict = /\+/.test(q);
  const terms = q
    .split(/[+,&]|\s+and\s+|\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  return { terms: uniq(terms), strict };
}

// Limited expansion: original + up to 2 high-confidence synonyms.
function expandTermLimited(term: string): string[] {
  const t = term.toLowerCase();
  const out: string[] = [term];
  if (BUILTIN_SYNONYMS[t]) {
    BUILTIN_SYNONYMS[t].slice(0, 2).forEach((s) => out.push(s));
  } else {
    for (const [k, vs] of Object.entries(BUILTIN_SYNONYMS)) {
      if (vs.includes(t)) { out.push(k); break; }
    }
  }
  return uniq(out).slice(0, 3);
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

function episodeFields(e: any) {
  const title = (e.title || "").toLowerCase();
  const summary = (e.summary || "").toLowerCase();
  const desc = (e.description || "").toLowerCase();
  const arrays = [
    ...(e.topics || []), ...(e.people || []), ...(e.companies || []),
    ...(e.tickers || []), ...(e.ingredients || []),
  ].map((x: string) => String(x).toLowerCase());
  return { title, summary, desc, arrays };
}

function termGroupHits(e: any, variants: string[]): { hit: boolean; titleHit: boolean; entityHit: boolean; bodyHit: boolean } {
  const { title, summary, desc, arrays } = episodeFields(e);
  const lc = variants.map((v) => v.toLowerCase());
  const titleHit = lc.some((v) => title.includes(v));
  const entityHit = lc.some((v) => arrays.includes(v) || arrays.some((a) => a.includes(v)));
  const bodyHit = lc.some((v) => summary.includes(v) || desc.includes(v));
  return { hit: titleHit || entityHit || bodyHit, titleHit, entityHit, bodyHit };
}

function scoreEpisode(e: any, termGroups: string[][]): { score: number; allHit: boolean; hitCount: number } {
  let s = 0;
  let hitCount = 0;
  let allHit = true;
  termGroups.forEach((variants) => {
    const h = termGroupHits(e, variants);
    if (h.hit) hitCount++;
    else allHit = false;
    if (h.titleHit) s += 150;
    if (h.entityHit) s += 70;
    if (h.bodyHit) s += 60;
    const orig = variants[0].toLowerCase();
    const titleLc = (e.title || "").toLowerCase();
    if (titleLc === orig) s += 250;
    else if (titleLc.includes(orig)) s += 90;
  });
  if (allHit && termGroups.length > 1) s += 120;
  s += hitCount * 25;
  if (e.published_at) {
    const ageDays = (Date.now() - new Date(e.published_at).getTime()) / 86400000;
    s += Math.max(0, 30 - ageDays) * 0.6;
    if (ageDays < 7) s += 10;
  }
  s += ((e.episode_rank ?? 0)) * 1.2;
  s += ((e.podcasts?.podiverzum_rank ?? 0)) * 0.4; // tie-breaker only
  return { score: s, allHit, hitCount };
}

// Build a compact OR filter for one term group (expanded variants).
function orFilterForVariants(variants: string[]): string {
  const ors: string[] = [];
  variants.forEach((t) => {
    const v = `%${escapeIlike(t)}%`;
    ors.push(`title.ilike.${v}`, `description.ilike.${v}`, `summary.ilike.${v}`);
    ors.push(`topics.cs.{${t}}`, `people.cs.{${t}}`, `companies.cs.{${t}}`, `tickers.cs.{${t}}`, `ingredients.cs.{${t}}`);
  });
  return ors.join(",");
}

async function queryEpisodesByGroups(termGroups: string[][]): Promise<any[]> {
  let eq = supabase.from("episodes").select(EPISODE_SELECT).limit(300);
  termGroups.forEach((variants) => { eq = eq.or(orFilterForVariants(variants)); });
  const { data } = await eq;
  return data || [];
}

// Per-term fallback: query each original term separately, merge & dedupe.
async function queryEpisodesPerTerm(terms: string[]): Promise<any[]> {
  const results = await Promise.all(
    terms.map(async (t) => {
      const { data } = await supabase
        .from("episodes")
        .select(EPISODE_SELECT)
        .or(orFilterForVariants([t]))
        .limit(150);
      return data || [];
    })
  );
  const map = new Map<string, any>();
  results.flat().forEach((e: any) => { if (!map.has(e.id)) map.set(e.id, e); });
  return Array.from(map.values());
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
      const termGroups = terms.map(expandTermLimited);

      // 1) Primary compact query (limited synonyms).
      let raw = await queryEpisodesByGroups(termGroups);
      let usedFallback = false;

      // 2) Zero-result fallback: per-term original-only queries, merged in JS.
      if (raw.length === 0) {
        raw = await queryEpisodesPerTerm(terms);
        if (raw.length > 0) usedFallback = true;
      }

      const scored = raw
        .map((e: any) => ({ e, ...scoreEpisode(e, termGroups) }))
        .filter((x) => x.hitCount > 0);

      let chosen = scored;
      if (termGroups.length > 1) {
        const allHit = scored.filter((x) => x.allHit);
        if (strict) {
          if (allHit.length > 0) {
            chosen = allHit;
          } else {
            // strict but expanded query returned no all-term hits — broaden.
            chosen = scored;
            if (scored.length > 0) usedFallback = true;
          }
        } else if (allHit.length > 0) {
          chosen = allHit;
        } else {
          chosen = scored;
          if (scored.length > 0) usedFallback = true;
        }
      }

      setBroadened(usedFallback);

      let filtered = chosen;
      if (catParam) filtered = filtered.filter((x) => (x.e.podcasts?.category || "") === catParam);
      const sortFn =
        sortParam === "newest"
          ? (a: any, b: any) => new Date(b.e.published_at || 0).getTime() - new Date(a.e.published_at || 0).getTime()
          : sortParam === "rank"
          ? (a: any, b: any) => (b.e.episode_rank || 0) - (a.e.episode_rank || 0)
          : (a: any, b: any) => b.score - a.score;
      const rankedEs = filtered.sort(sortFn).slice(0, 80).map((x) => x.e);
      setEpisodes(rankedEs as any);
      setCategories(uniq<string>(rankedEs.map((e: any) => e.podcasts?.category).filter(Boolean) as string[]));

      // Podcasts query — keep compact too.
      let pq = supabase
        .from("podcasts")
        .select("id,title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,rss_status,podiverzum_rank")
        .limit(60);
      termGroups.forEach((variants) => {
        const ors = variants.flatMap((t) => {
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
            No exact episode matches yet. Try a broader search or remove one term. You can also <Link to="/categories" className="underline text-foreground">browse categories</Link>.
          </div>
        )}

        {initial && (podcasts.length > 0 || episodes.length > 0) && (
          <div className="mt-8 space-y-10">
            <section>
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                Matching episodes ({episodes.length})
                {broadened && (
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
          Indexed from public RSS feeds. Ranked by freshness, feed health and episode relevance.
        </p>
      </div>
    </Layout>
  );
}
