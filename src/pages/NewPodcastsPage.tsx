import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { supabase } from "@/integrations/supabase/client";
import { setSeo } from "@/lib/seo";

export default function NewPodcastsPage() {
  const [items, setItems] = useState<PodcastLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSeo({
      title: "Recently added podcasts — Podiverzum",
      description: "The newest podcasts indexed by Podiverzum. Fresh shows, ranked by quality and feed health.",
    });
    supabase
      .from("podcasts")
      .select("id,title,display_title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,rss_status,podiverzum_rank,rank_label,created_at,language")
      .not("rss_status", "in", "(failed,inactive)")
      .not("rank_label", "eq", "E")
      // EN-only site: hide non-English shows. NULL = treated as EN (legacy untagged feeds).
      .or("language.is.null,language.ilike.hu%")
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(60)
      .then(({ data }) => {
        setItems((data || []) as any);
        setLoading(false);
      });
  }, []);

  return (
    <Layout>
      <div className="container mx-auto py-12 max-w-5xl">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Fresh in the index</div>
        <h1 className="text-3xl font-semibold mt-2">Recently added podcasts</h1>
        <p className="text-muted-foreground mt-2 text-sm max-w-xl">
          The newest shows discovered, vetted and indexed by Podiverzum. Updated continuously.
        </p>
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((p) => <PodcastCard key={p.id} p={p} />)}
        </div>
        {!loading && !items.length && (
          <p className="text-muted-foreground mt-8">No new podcasts yet. Check back soon.</p>
        )}
      </div>
    </Layout>
  );
}
