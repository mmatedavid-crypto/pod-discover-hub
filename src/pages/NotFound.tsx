import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { Compass } from "lucide-react";

export default function NotFound() {
  const location = useLocation();
  const [suggestions, setSuggestions] = useState<PodcastLite[]>([]);

  useEffect(() => {
    setSeo({
      title: "Page not found — Podiverzum",
      description: "The page you're looking for doesn't exist on Podiverzum. Browse top podcasts instead.",
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
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight mb-3">Lost in the podiverse</h1>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            That page doesn't exist — but here's some great listening to point you home.
          </p>
          <div className="flex flex-wrap gap-3 justify-center text-sm">
            <Link to="/" className="px-4 py-2 rounded-md bg-primary text-primary-foreground">Go home</Link>
            <Link to="/categories" className="px-4 py-2 rounded-md border border-border hover:border-foreground/40">Browse categories</Link>
            <Link to="/search" className="px-4 py-2 rounded-md border border-border hover:border-foreground/40">Search episodes</Link>
          </div>
        </div>

        {suggestions.length > 0 && (
          <section className="mt-14">
            <h2 className="font-semibold mb-4 text-center">Popular right now</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {suggestions.map((p) => <PodcastCard key={p.id} p={p} />)}
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}
