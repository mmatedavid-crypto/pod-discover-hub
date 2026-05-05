import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { setSeo } from "@/lib/seo";
import NotFoundState from "@/components/NotFoundState";

export default function CategoryDetail() {
  const { slug } = useParams();
  const [cat, setCat] = useState<any>(null);
  const [podcasts, setPodcasts] = useState<PodcastLite[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeLite[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      const { data: c } = await supabase.from("categories").select("*").eq("slug", slug).maybeSingle();
      setCat(c);
      setLoading(false);
      if (!c) return;
      setSeo({
        title: `${c.name} podcast episodes — Podiverzum`,
        description: `Discover the latest podcast episodes in ${c.name}, ranked by relevance, freshness and Podiverzum Rank.`,
      });
      const { data: ps } = await supabase
        .from("podcasts")
        .select("id,title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,rss_status,podiverzum_rank")
        .eq("category", c.name)
        .order("featured", { ascending: false })
        .order("podiverzum_rank", { ascending: false })
        .limit(60);
      const visible = (ps || []).filter((p: any) => p.featured || (p.rss_status !== "failed" && p.rss_status !== "inactive"));
      const ids0 = visible.map((p: any) => p.id);
      const epCountMap: Record<string, number> = {};
      if (ids0.length) {
        const { data: ec } = await supabase.from("episodes").select("podcast_id").in("podcast_id", ids0);
        (ec || []).forEach((e: any) => { epCountMap[e.podcast_id] = (epCountMap[e.podcast_id] || 0) + 1; });
      }
      const high = visible.filter((p: any) => p.featured || ((p.podiverzum_rank ?? 1) >= 6 && (epCountMap[p.id] || 0) > 0));
      const mid = visible.filter((p: any) => !p.featured && (p.podiverzum_rank ?? 1) >= 4 && (p.podiverzum_rank ?? 1) < 6 && (epCountMap[p.id] || 0) > 0);
      const promotedPodcasts = (high.length >= 6 ? high : [...high, ...mid]).slice(0, 12);
      setPodcasts(promotedPodcasts);

      const promotedIds = promotedPodcasts.map((p: any) => p.id);
      if (promotedIds.length) {
        const { data: eps } = await supabase
          .from("episodes")
          .select("id,title,slug,summary,description,published_at,audio_url,episode_rank,topics,podcasts!inner(slug,title,image_url,category,podiverzum_rank)")
          .in("podcast_id", promotedIds)
          .order("episode_rank", { ascending: false })
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(40);
        const sorted = (eps || []).slice().sort((a: any, b: any) => {
          const ar = a.episode_rank ?? 0, br = b.episode_rank ?? 0;
          if (br !== ar) return br - ar;
          const at = a.published_at ? new Date(a.published_at).getTime() : 0;
          const bt = b.published_at ? new Date(b.published_at).getTime() : 0;
          if (bt !== at) return bt - at;
          return (b.podcasts?.podiverzum_rank ?? 0) - (a.podcasts?.podiverzum_rank ?? 0);
        }).slice(0, 25);
        setEpisodes(sorted as any);
        const t = new Map<string, number>();
        (sorted || []).forEach((e: any) => (e.topics || []).forEach((x: string) => t.set(x, (t.get(x) || 0) + 1)));
        setTopics([...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k));
      }
    })();
  }, [slug]);

  if (loading) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!cat) return <NotFoundState title="Category not found" message="That category doesn't exist or has been removed." />;
  return (
    <Layout>
      <div className="container mx-auto py-10">
        <h1 className="text-3xl font-semibold">{cat.name}</h1>
        <p className="text-muted-foreground mt-1">
          Latest podcast episodes in {cat.name}, ranked by freshness, relevance and Podiverzum Rank.
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-4">Latest episodes in {cat.name}</h2>
        {episodes.length > 0 ? (
          <EpisodeList items={episodes} showTopics />
        ) : (
          <div className="p-6 border border-border rounded-lg bg-card text-sm text-muted-foreground">
            No episodes indexed in this category yet. Podiverzum is still growing automatically.
          </div>
        )}

        {topics.length > 0 && (
          <>
            <h2 className="text-xl font-semibold mt-10 mb-3">Popular topics</h2>
            <div className="flex flex-wrap gap-2">
              {topics.map((t) => (
                <Link key={t} to={`/search?q=${encodeURIComponent(t)}`} className="px-3 py-1 rounded-full bg-secondary text-sm hover:bg-accent hover:text-accent-foreground">
                  {t}
                </Link>
              ))}
            </div>
          </>
        )}

        {podcasts.length > 0 && (
          <>
            <h2 className="text-xl font-semibold mt-10 mb-4">Top podcasts in {cat.name}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {podcasts.map((p) => <PodcastCard key={p.id} p={p} />)}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
