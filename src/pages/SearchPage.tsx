import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { Search } from "lucide-react";
import { setSeo } from "@/lib/seo";

function parseTerms(q: string) {
  return q.split(/[+,&]| and /i).map((s) => s.trim()).filter(Boolean);
}

function uniq<T>(a: T[]) { return Array.from(new Set(a)); }

async function expandTerm(term: string): Promise<string[]> {
  const t = term.toLowerCase();
  const { data } = await supabase
    .from("search_synonyms")
    .select("term,synonyms")
    .or(`term.eq.${t},synonyms.cs.{${t}}`);
  const out = new Set<string>([term]);
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
  termGroups.forEach((variants, i) => {
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
  termGroups.forEach((variants) => {
    const lc = variants.map((v) => v.toLowerCase());
    const orig = lc[0];
    if (title === orig) s += 60;
    if (title.includes(orig)) s += 30;
    if (lc.some((v) => title.includes(v))) s += 15;
    if (lc.some((v) => arrays.includes(v))) s += 18;
    if (lc.some((v) => arrays.some((a) => a.includes(v)))) s += 8;
    if (lc.some((v) => summary.includes(v))) s += 7;
    if (lc.some((v) => desc.includes(v))) s += 3;
  });
  // Recency boost
  if (e.published_at) {
    const ageDays = (Date.now() - new Date(e.published_at).getTime()) / 86400000;
    s += Math.max(0, 30 - ageDays) * 0.5; // up to ~15
    if (ageDays < 7) s += 10;
    else if (ageDays < 30) s += 5;
  }
  return s;
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get("q") || "";
  const [q, setQ] = useState(initial);
  const [podcasts, setPodcasts] = useState<PodcastLite[]>([]);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setQ(initial); }, [initial]);

  useEffect(() => {
    setSeo({
      title: initial ? `${initial} — Podiverzum search` : "Search podcasts — Podiverzum",
      description: initial
        ? `Podcast episodes matching "${initial}". Search by topic, person, company or ticker.`
        : "Search podcast episodes by topic, person, company, ticker or ingredient.",
    });
    if (!initial) { setPodcasts([]); setEpisodes([]); return; }
    const terms = parseTerms(initial);
    if (!terms.length) return;
    setLoading(true);
    (async () => {
      const termGroups = await Promise.all(terms.map(expandTerm));

      // Podcasts: AND across term groups; within group, OR over fields & synonyms
      let pq = supabase
        .from("podcasts")
        .select("id,title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url")
        .limit(60);
      termGroups.forEach((variants) => {
        const ors = uniq(variants).flatMap((t) => {
          const v = `%${escapeIlike(t)}%`;
          return [`title.ilike.${v}`, `description.ilike.${v}`, `summary.ilike.${v}`, `category.ilike.${v}`];
        }).join(",");
        pq = pq.or(ors);
      });
      const { data: ps } = await pq;
      const rankedPs = (ps || [])
        .map((p) => ({ p, s: scorePodcast(p, termGroups) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 24)
        .map((x) => x.p);
      setPodcasts(rankedPs);

      // Episodes: AND across term groups
      let eq = supabase
        .from("episodes")
        .select("id,title,slug,published_at,summary,description,topics,people,companies,tickers,ingredients,podcast_id,podcasts!inner(slug,title,image_url)")
        .limit(200);
      termGroups.forEach((variants) => {
        const ors: string[] = [];
        uniq(variants).forEach((t) => {
          const v = `%${escapeIlike(t)}%`;
          ors.push(`title.ilike.${v}`, `description.ilike.${v}`, `summary.ilike.${v}`);
          ors.push(`topics.cs.{${t}}`, `people.cs.{${t}}`, `companies.cs.{${t}}`, `tickers.cs.{${t}}`, `ingredients.cs.{${t}}`);
        });
        eq = eq.or(ors.join(","));
      });
      const { data: es } = await eq;
      const rankedEs = (es || [])
        .map((e: any) => ({ e, s: scoreEpisode(e, termGroups) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 60)
        .map((x) => x.e);
      setEpisodes(rankedEs);
      setLoading(false);
    })();
  }, [initial]);

  return (
    <Layout>
      <div className="container mx-auto py-10">
        <h1 className="text-3xl font-semibold mb-2">Search</h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Combine terms with <code className="px-1 bg-secondary rounded">+</code> — e.g. <em>cooking + asparagus</em>, <em>AI + healthcare</em>, <em>stocks + Occidental</em>.
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); setParams({ q }); }}
          className="relative max-w-2xl"
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="cooking + asparagus"
            className="w-full pl-10 pr-24 py-3 rounded-md bg-card border border-border focus:border-accent outline-none"
          />
          <button className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm">
            Search
          </button>
        </form>

        {initial && !loading && podcasts.length === 0 && episodes.length === 0 && (
          <div className="mt-10 p-6 border border-border rounded-lg bg-card text-sm text-muted-foreground">
            No matching podcast episodes found yet. Try another keyword or <Link to="/categories" className="underline text-foreground">browse categories</Link>.
          </div>
        )}

        {initial && (podcasts.length > 0 || episodes.length > 0) && (
          <div className="mt-10 grid lg:grid-cols-3 gap-8">
            <section className="lg:col-span-1">
              <h2 className="font-semibold mb-3">Podcasts ({podcasts.length})</h2>
              <div className="grid gap-3">
                {podcasts.map((p) => <PodcastCard key={p.id} p={p} />)}
                {!loading && !podcasts.length && <div className="text-sm text-muted-foreground">No podcasts.</div>}
              </div>
            </section>
            <section className="lg:col-span-2">
              <h2 className="font-semibold mb-3">Episodes ({episodes.length})</h2>
              <ul className="divide-y divide-border border border-border rounded-lg bg-card">
                {episodes.map((e: any) => (
                  <li key={e.id} className="p-4 hover:bg-secondary/50">
                    <Link to={`/podcast/${e.podcasts.slug}/${e.slug}`} className="block">
                      <div className="font-medium">{e.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {e.podcasts.title}{e.published_at && ` · ${new Date(e.published_at).toLocaleDateString()}`}
                      </div>
                      {(e.summary || e.description) && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{e.summary || e.description}</p>
                      )}
                    </Link>
                  </li>
                ))}
                {!loading && !episodes.length && <li className="p-4 text-sm text-muted-foreground">No episodes.</li>}
              </ul>
            </section>
          </div>
        )}
      </div>
    </Layout>
  );
}
