import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Apple, Music, Youtube, Globe } from "lucide-react";
import { PodcastCover } from "@/components/PodcastCover";
import { setSeo } from "@/lib/seo";

export default function PodcastDetail() {
  const { podcastSlug } = useParams();
  const [p, setP] = useState<any>(null);
  const [eps, setEps] = useState<any[]>([]);

  useEffect(() => {
    if (!podcastSlug) return;
    (async () => {
      const { data } = await supabase.from("podcasts").select("*").eq("slug", podcastSlug).single();
      setP(data);
      if (data) {
        setSeo({
          title: `${data.title} — podcast on Podiverzum`,
          description: (data.summary || data.description || `Listen to ${data.title} on Podiverzum.`).slice(0, 160),
          jsonLd: {
            "@context": "https://schema.org",
            "@type": "PodcastSeries",
            name: data.title,
            description: data.summary || data.description || undefined,
            image: data.image_url || undefined,
            url: typeof window !== "undefined" ? window.location.href : undefined,
            webFeed: data.rss_url || undefined,
          },
        });
        const { data: e } = await supabase
          .from("episodes")
          .select("id,title,slug,published_at,summary,description")
          .eq("podcast_id", data.id)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(40);
        setEps(e || []);
      }
    })();
  }, [podcastSlug]);

  if (loading) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!p) return <NotFoundState title="Podcast not found" message="That podcast doesn't exist or has been removed." />;
  return (
    <Layout>
      <div className="container mx-auto py-10">
        <div className="flex flex-col sm:flex-row gap-6">
          <div className="w-40 shrink-0">
            <PodcastCover title={p.title} src={p.image_url} size="lg" />
          </div>
          <div className="min-w-0">
            {p.category && (
              <Link to={`/category/${p.category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="text-xs uppercase tracking-wide text-accent">
                {p.category}
              </Link>
            )}
            <h1 className="text-3xl font-semibold mt-1">{p.title}</h1>
            {p.summary && <p className="mt-3 text-foreground/90 max-w-2xl">{p.summary}</p>}
            {p.description && p.description !== p.summary && (
              <p className="mt-2 text-sm text-muted-foreground max-w-2xl line-clamp-4">{p.description}</p>
            )}
            <div className="flex gap-3 mt-4 text-muted-foreground">
              {p.apple_url && <a href={p.apple_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent text-sm"><Apple className="h-4 w-4" /> Apple</a>}
              {p.spotify_url && <a href={p.spotify_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent text-sm"><Music className="h-4 w-4" /> Spotify</a>}
              {p.youtube_url && <a href={p.youtube_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent text-sm"><Youtube className="h-4 w-4" /> YouTube</a>}
              {p.website_url && <a href={p.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent text-sm"><Globe className="h-4 w-4" /> Website</a>}
            </div>
          </div>
        </div>

        <h2 className="text-xl font-semibold mt-10 mb-4">Latest episodes</h2>
        {eps.length === 0 ? (
          <div className="text-muted-foreground">No episodes yet.</div>
        ) : (
          <ul className="divide-y divide-border border border-border rounded-lg bg-card">
            {eps.map((e) => (
              <li key={e.id} className="p-4 hover:bg-secondary/50">
                <Link to={`/podcast/${p.slug}/${e.slug}`} className="block">
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {e.published_at && new Date(e.published_at).toLocaleDateString()}
                  </div>
                  {(e.summary || e.description) && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{e.summary || e.description}</p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layout>
  );
}
