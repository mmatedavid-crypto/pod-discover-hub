import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { Search } from "lucide-react";

function parseTerms(q: string) {
  return q.split(/[+,&]| and /i).map((s) => s.trim()).filter(Boolean);
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
    document.title = initial ? `${initial} — Podiverzum search` : "Search — Podiverzum";
    if (!initial) { setPodcasts([]); setEpisodes([]); return; }
    const terms = parseTerms(initial);
    if (!terms.length) return;
    setLoading(true);
    (async () => {
      // Podcasts: AND across terms over title/description/summary/category
      let pq = supabase.from("podcasts").select("id,title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url").limit(20);
      terms.forEach((t) => {
        const v = `%${t}%`;
        pq = pq.or(`title.ilike.${v},description.ilike.${v},summary.ilike.${v},category.ilike.${v}`);
      });
      const { data: ps } = await pq;
      setPodcasts(ps || []);

      // Episodes: AND across terms over title/description/summary/topics/people/companies/tickers
      let eq = supabase.from("episodes").select("id,title,slug,published_at,summary,description,topics,people,companies,tickers,podcast_id,podcasts!inner(slug,title,image_url)").limit(40);
      terms.forEach((t) => {
        const v = `%${t}%`;
        eq = eq.or(
          `title.ilike.${v},description.ilike.${v},summary.ilike.${v},topics.cs.{${t}},people.cs.{${t}},companies.cs.{${t}},tickers.cs.{${t}},ingredients.cs.{${t}}`,
        );
      });
      const { data: es } = await eq.order("published_at", { ascending: false, nullsFirst: false });
      setEpisodes(es || []);
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
