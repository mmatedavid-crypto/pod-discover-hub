import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { Link } from "react-router-dom";
import { Search, ArrowRight } from "lucide-react";

type Category = { id: string; name: string; slug: string; description: string | null };

const Index = () => {
  const [q, setQ] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [byCat, setByCat] = useState<Record<string, PodcastLite[]>>({});
  const nav = useNavigate();

  useEffect(() => {
    document.title = "Podiox — Podcast discovery & search";
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", "Discover podcasts by category and search episodes by keyword combinations like cooking + asparagus or AI + healthcare.");

    (async () => {
      const { data: c } = await supabase.from("categories").select("*").order("sort_order");
      setCats(c || []);
      const { data: ps } = await supabase
        .from("podcasts")
        .select("id,title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,featured_rank")
        .order("featured", { ascending: false })
        .order("featured_rank", { ascending: true, nullsFirst: false })
        .limit(200);
      const grouped: Record<string, PodcastLite[]> = {};
      (ps || []).forEach((p: any) => {
        if (!p.category) return;
        (grouped[p.category] ||= []).push(p);
      });
      setByCat(grouped);
    })();
  }, []);

  return (
    <Layout>
      <section className="border-b border-border">
        <div className="container mx-auto py-12 sm:py-20">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight max-w-3xl">
            Find the podcast worth your hour.
          </h1>
          <p className="text-muted-foreground mt-3 max-w-2xl">
            Browse the best shows by category, or search across thousands of episodes by combining keywords.
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
              className="w-full pl-12 pr-28 py-4 rounded-lg bg-card border border-border focus:border-accent outline-none text-base"
            />
            <button className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
              Search
            </button>
          </form>
        </div>
      </section>

      <div className="container mx-auto py-10 space-y-12">
        {cats.map((c) => {
          const items = byCat[c.name]?.slice(0, 10) || [];
          if (!items.length) return null;
          return (
            <section key={c.id}>
              <div className="flex items-end justify-between mb-4">
                <h2 className="text-xl font-semibold">{c.name}</h2>
                <Link to={`/category/${c.slug}`} className="text-sm text-muted-foreground hover:text-accent inline-flex items-center gap-1">
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
            No podcasts yet. <Link to="/admin" className="text-accent underline">Add some in admin</Link>.
          </div>
        )}
      </div>
    </Layout>
  );
};

export default Index;
