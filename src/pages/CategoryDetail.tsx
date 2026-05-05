import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { setSeo } from "@/lib/seo";

export default function CategoryDetail() {
  const { slug } = useParams();
  const [cat, setCat] = useState<any>(null);
  const [podcasts, setPodcasts] = useState<PodcastLite[]>([]);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [topics, setTopics] = useState<string[]>([]);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data: c } = await supabase.from("categories").select("*").eq("slug", slug).single();
      setCat(c);
      if (!c) return;
      setSeo({
        title: `Best ${c.name} podcasts — Podiverzum`,
        description: c.description
          ? `${c.description} Discover top ${c.name.toLowerCase()} podcasts and the latest episodes.`
          : `Top ${c.name} podcasts and latest episodes on Podiverzum.`,
      });
      const { data: ps } = await supabase
        .from("podcasts")
        .select("id,title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url")
        .eq("category", c.name)
        .order("featured", { ascending: false })
        .order("featured_rank", { ascending: true, nullsFirst: false })
        .limit(20);
      setPodcasts(ps || []);
      const ids = (ps || []).map((p) => p.id);
      if (ids.length) {
        const { data: eps } = await supabase
          .from("episodes")
          .select("id,title,slug,published_at,topics,podcast_id,podcasts!inner(slug,title,image_url)")
          .in("podcast_id", ids)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(15);
        setEpisodes(eps || []);
        const t = new Map<string, number>();
        (eps || []).forEach((e: any) => (e.topics || []).forEach((x: string) => t.set(x, (t.get(x) || 0) + 1)));
        setTopics([...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k));
      }
    })();
  }, [slug]);

  if (!cat) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  return (
    <Layout>
      <div className="container mx-auto py-10">
        <h1 className="text-3xl font-semibold">{cat.name}</h1>
        {cat.description && <p className="text-muted-foreground mt-1">{cat.description}</p>}

        <h2 className="text-xl font-semibold mt-10 mb-4">Top podcasts</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {podcasts.map((p) => <PodcastCard key={p.id} p={p} />)}
          {!podcasts.length && <div className="text-muted-foreground">No podcasts in this category yet.</div>}
        </div>

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

        {episodes.length > 0 && (
          <>
            <h2 className="text-xl font-semibold mt-10 mb-4">Latest episodes</h2>
            <ul className="divide-y divide-border border border-border rounded-lg bg-card">
              {episodes.map((e: any) => (
                <li key={e.id} className="p-4 hover:bg-secondary/50">
                  <Link to={`/podcast/${e.podcasts.slug}/${e.slug}`} className="block">
                    <div className="font-medium line-clamp-1">{e.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {e.podcasts.title}{e.published_at && ` · ${new Date(e.published_at).toLocaleDateString()}`}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Layout>
  );
}
