import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import NotFoundState from "@/components/NotFoundState";
import { PodcastCard } from "@/components/PodcastCard";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { compareByScore } from "@/lib/episodeRank";
import { ArrowLeft, Sparkles } from "lucide-react";

export default function MoodCollectionPage() {
  const { slug } = useParams();
  const [mood, setMood] = useState<any>(null);
  const [podcasts, setPodcasts] = useState<any[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      const { data: m } = await supabase
        .from("mood_collections" as any)
        .select("*").eq("slug", slug).eq("active", true).maybeSingle();
      setMood(m);
      setLoading(false);
      if (!m) return;
      setSeo({
        title: `${(m as any).title} — podcast collection | Podiverzum`,
        description: (m as any).description || `Hand-picked podcasts and episodes for ${(m as any).mood}.`,
      });
      const ids: string[] = (m as any).podcast_ids || [];
      const epIds: string[] = (m as any).episode_ids || [];
      if (ids.length) {
        const { data: ps } = await supabase.from("podcasts")
          .select("id,title,display_title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,rss_status,podiverzum_rank,rank_label")
          .in("id", ids);
        setPodcasts(ps || []);
        // Latest episodes from these podcasts
        const { data: eps } = await supabase
          .from("episodes")
          .select("id,title,display_title,slug,summary,ai_summary,description,published_at,audio_url,topics,podcasts!inner(slug,title,display_title,image_url,category,podiverzum_rank,rank_label)")
          .in("podcast_id", ids)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(40);
        const sorted = (eps || []).slice().sort(compareByScore).slice(0, 18) as any;
        setEpisodes(sorted);
      } else if (epIds.length) {
        const { data: eps } = await supabase
          .from("episodes")
          .select("id,title,display_title,slug,summary,ai_summary,description,published_at,audio_url,topics,podcasts!inner(slug,title,display_title,image_url,category,podiverzum_rank,rank_label)")
          .in("id", epIds);
        setEpisodes((eps || []) as any);
      }
    })();
  }, [slug]);

  if (loading) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!mood) return <NotFoundState title="Collection not found" message="That collection doesn't exist or is no longer active." />;

  const accent = mood.accent_hsl ? `hsl(${mood.accent_hsl})` : "hsl(var(--primary))";
  const empty = podcasts.length === 0 && episodes.length === 0;

  return (
    <Layout>
      <div className="container mx-auto py-10 max-w-5xl">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Back home
        </Link>
        <div className="mt-3 rounded-2xl border border-border bg-card/60 p-6 sm:p-8" style={{ background: `linear-gradient(135deg, ${accent}1a, transparent 70%), hsl(var(--card) / 0.6)` }}>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] mb-2" style={{ color: accent }}>
            <Sparkles className="h-3 w-3" /> Mood collection
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold">{mood.title}</h1>
          <p className="text-muted-foreground mt-2">{mood.description || mood.mood}</p>
        </div>

        {empty ? (
          <div className="mt-10 p-6 border border-border rounded-lg bg-card text-sm text-muted-foreground">
            This collection is being curated. Check back soon.
          </div>
        ) : (
          <>
            {episodes.length > 0 && (
              <section className="mt-10">
                <h2 className="font-semibold mb-3">Latest episodes</h2>
                <EpisodeList items={episodes} />
              </section>
            )}
            {podcasts.length > 0 && (
              <section className="mt-10">
                <h2 className="font-semibold mb-3">Podcasts in this collection</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {podcasts.map((p) => <PodcastCard key={p.id} p={p} />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
