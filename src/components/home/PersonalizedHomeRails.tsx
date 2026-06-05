import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { Sparkles } from "lucide-react";
import { Skeleton } from "@/components/Skeletons";

type RpcRow = {
  episode_id: string;
  podcast_id: string;
  title: string;
  display_title: string | null;
  slug: string | null;
  image_url: string | null;
  ai_summary: string | null;
  podcast_title: string | null;
  podcast_slug: string | null;
  podcast_image_url: string | null;
  similarity?: number;
};

type Rail = { key: string; label: string; items: RpcRow[] };
type Payload = { main: Rail; rails: Rail[] };

function toEp(r: RpcRow): EpisodeLite {
  return {
    id: r.episode_id,
    title: r.title,
    display_title: r.display_title || undefined,
    slug: r.slug || "",
    summary: r.ai_summary || undefined,
    description: null,
    published_at: null,
    audio_url: null,
    topics: null,
    podcasts: {
      slug: r.podcast_slug || "",
      title: r.podcast_title || "",
      display_title: r.podcast_title || undefined,
      image_url: r.podcast_image_url || null,
      category: undefined,
    } as any,
    image_url: r.image_url || null,
  } as EpisodeLite;
}

export function PersonalizedHomeRails() {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data: res } = await supabase.functions.invoke("personalized-home-rails");
        if (!cancelled && res) setData(res as Payload);
      } catch {
        /* silent — fallback to other home sections */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  if (!user) return null;
  if (loading && !data) {
    return (
      <section>
        <Skeleton className="h-6 w-56 mb-4" />
        <div className="grid sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </section>
    );
  }
  if (!data) return null;

  const mainItems = (data.main?.items || []).map(toEp);
  const rails = (data.rails || []).filter((r) => r.items?.length);

  if (!mainItems.length && !rails.length) return null;

  return (
    <div className="space-y-8">
      {mainItems.length > 0 && (
        <section>
          <div className="flex items-end justify-between mb-4">
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-accent mb-1">
                <Sparkles className="h-3 w-3" /> Neked
              </div>
              <h2 className="text-xl sm:text-2xl font-semibold">Neked ajánljuk</h2>
              <p className="text-xs text-muted-foreground mt-1">
                A korábbi hallgatásaidhoz és érdeklődéseidhez közel álló epizódok.
              </p>
            </div>
          </div>
          <EpisodeList items={mainItems.slice(0, 8)} scrollOnMobile />
        </section>
      )}
      {rails.map((rail) => (
        <section key={rail.key}>
          <div className="flex items-end justify-between mb-4">
            <h2 className="text-lg sm:text-xl font-semibold tracking-tight">{rail.label}</h2>
          </div>
          <EpisodeList items={rail.items.map(toEp).slice(0, 8)} scrollOnMobile />
        </section>
      ))}
    </div>
  );
}
