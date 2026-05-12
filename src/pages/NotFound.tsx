import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { Compass, Search } from "lucide-react";

export default function NotFound() {
  const location = useLocation();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<PodcastLite[]>([]);

  useEffect(() => {
    setSeo({
      title: "Nincs ilyen oldal — Podiverzum",
      description: "A keresett oldal nem létezik a Podiverzumon. Böngéssz a top podcastek között.",
      noindex: true,
    });
    console.warn("404:", location.pathname);
    supabase
      .from("podcasts")
      .select("id,title,display_title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,rss_status")
      .or("featured.eq.true,rank_label.eq.S")
      .not("rss_status", "in", "(failed,inactive)")
      .order("featured", { ascending: false })
      .order("podiverzum_rank", { ascending: false })
      .limit(6)
      .then(({ data }) => setSuggestions((data as any) || []));
  }, [location.pathname]);

  return (
    <Layout>
      <div className="container mx-auto py-16 max-w-4xl">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-card text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-4">
            <Compass className="h-3 w-3" /> 404
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight mb-3">Eltévedtél a podiverzumban</h1>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Ez az oldal nem létezik — de próbálj keresni, vagy válassz a népszerű podcastek közül.
          </p>
          <form
            onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`); }}
            className="relative max-w-xl mx-auto mb-6"
          >
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Keress epizódokat, embereket, cégeket, ötleteket…"
              className="w-full pl-12 pr-28 py-3 rounded-xl bg-card border border-border focus:border-primary/50 outline-none text-base placeholder:text-muted-foreground/60"
            />
            <button className="btn-brand absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 rounded-lg text-sm font-semibold">
              Keresés
            </button>
          </form>
          <div className="flex flex-wrap gap-3 justify-center text-sm">
            <Link to="/" className="px-4 py-2 rounded-md bg-primary text-primary-foreground">Kezdőlap</Link>
            <Link to="/kategoriak" className="px-4 py-2 rounded-md border border-border hover:border-foreground/40">Kategóriák</Link>
          </div>
        </div>

        {suggestions.length > 0 && (
          <section className="mt-14">
            <h2 className="font-semibold mb-4 text-center">Most népszerű</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {suggestions.map((p) => <PodcastCard key={p.id} p={p} />)}
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}
