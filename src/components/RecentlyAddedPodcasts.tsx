import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PodcastCard, PodcastLite } from "./PodcastCard";

export function RecentlyAddedPodcasts({ limit = 6, showLink = true }: { limit?: number; showLink?: boolean }) {
  const [items, setItems] = useState<PodcastLite[]>([]);

  useEffect(() => {
    // Trusted-HU gate (same rule as the homepage ticker): only podcasts that are
    // verified Hungarian, already ranked, and have been in the catalog 14+ days.
    // Newly arrived / unverified shows never appear until the filter confirms them.
    const trustedBefore = new Date(Date.now() - 14 * 86400_000).toISOString();
    supabase
      .from("podcasts")
      .select("id,title,display_title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,rss_status,podiverzum_rank,rank_label,created_at,language,language_decision")
      .not("rss_status", "in", "(failed,inactive)")
      .eq("language_decision", "accept_hungarian")
      .eq("is_hungarian", true)
      .eq("detected_language", "hu")
      .not("rank_label", "is", null)
      .lt("created_at", trustedBefore)
      .or("language.ilike.hu%,language.ilike.mag%")
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(limit)
      .then(({ data }) => setItems((data || []) as any));
  }, [limit]);

  if (!items.length) return null;

  return (
    <section>
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">
            <Plus className="h-3 w-3" /> Nemrég hozzáadva
          </div>
          <h2 className="text-xl sm:text-2xl font-semibold">Új podcastok</h2>
        </div>
        {showLink && (
          <Link to="/uj-podcastok" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            Összes <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((p) => <PodcastCard key={p.id} p={p} />)}
      </div>
    </section>
  );
}
