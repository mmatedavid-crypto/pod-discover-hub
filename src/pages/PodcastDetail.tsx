import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Apple, Music, Youtube, Globe, Activity, AlertTriangle } from "lucide-react";
import { PodcastCover } from "@/components/PodcastCover";
import { setSeo, ogImageUrl } from "@/lib/seo";
import NotFoundState from "@/components/NotFoundState";
import { stripHtml, snippet } from "@/lib/text";
import { PodcastDetailSkeleton } from "@/components/Skeletons";
import { SimilarPodcasts } from "@/components/SimilarPodcasts";
import { SharePanel } from "@/components/SharePanel";
import { freshnessOf, relativeTime } from "@/lib/freshness";

export default function PodcastDetail() {
  const { podcastSlug } = useParams();
  const [p, setP] = useState<any>(null);
  const [eps, setEps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!podcastSlug) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("podcasts").select("*").eq("slug", podcastSlug).maybeSingle();
      setP(data);
      setLoading(false);
      if (data) {
        const cleanSummary = stripHtml(data.summary);
        const cleanDesc = stripHtml(data.description);
        setSeo({
          title: data.seo_title || `${data.title} — podcast on Podiverzum`,
          description: snippet(data.seo_description || cleanSummary || cleanDesc || `Listen to ${data.title} on Podiverzum.`, 160),
          noindex: data.rss_status === "failed" || data.rss_status === "inactive",
          image: ogImageUrl({ kind: "podcast", title: data.display_title || data.title, subtitle: data.category || "Podcast", image: data.image_url }),
          jsonLd: {
            "@context": "https://schema.org",
            "@type": "PodcastSeries",
            name: data.title,
            description: data.seo_description || cleanSummary || cleanDesc || undefined,
            image: data.image_url || undefined,
            url: typeof window !== "undefined" ? window.location.href : undefined,
            webFeed: data.rss_url || undefined,
          },
        });
        const { data: e } = await supabase
          .from("episodes")
          .select("id,title,display_title,slug,published_at,summary,description,audio_url")
          .eq("podcast_id", data.id)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(60);
        setEps(e || []);
      }
    })();
  }, [podcastSlug]);

  if (loading) return <Layout><PodcastDetailSkeleton /></Layout>;
  if (!p) return <NotFoundState title="Podcast not found" message="That podcast doesn't exist or has been removed." />;

  const healthState = (p.shadow_rank_components as any)?.health_state;
  const isHealthy = !healthState || healthState === "healthy" || healthState === "recovered_rss_url";
  const lastFresh = p.last_fetched_at ? relativeTime(p.last_fetched_at) : null;

  return (
    <Layout>
      <div className="container mx-auto py-10">
        <div className="flex flex-col sm:flex-row gap-6">
          <div className="w-40 shrink-0">
            <PodcastCover title={p.display_title || p.title} src={p.image_url} size="lg" />
          </div>
          <div className="min-w-0">
            {p.category && (
              <Link to={`/category/${p.category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="text-xs uppercase tracking-wide text-accent">
                {p.category}
              </Link>
            )}
            <h1 className="text-3xl font-semibold mt-1">{p.display_title || p.title}</h1>

            <div className="flex flex-wrap gap-2 mt-2 items-center text-xs">
              {p.rank_label && (
                <span className="px-1.5 py-0.5 rounded-md border border-primary/30 bg-primary/10 text-[10px] font-medium text-primary">
                  Tier {p.rank_label}
                </span>
              )}
              {isHealthy ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-green-500/30 bg-green-500/10 text-[10px] font-medium text-green-400">
                  <Activity className="h-3 w-3" /> Active feed
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-amber-500/30 bg-amber-500/10 text-[10px] font-medium text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> Feed issues
                </span>
              )}
              {lastFresh && (
                <span className="text-muted-foreground" title={new Date(p.last_fetched_at).toLocaleString()}>
                  Updated {lastFresh}
                </span>
              )}
            </div>

            {p.summary && <p className="mt-3 text-foreground/90 max-w-2xl">{stripHtml(p.summary)}</p>}
            {p.description && stripHtml(p.description) !== stripHtml(p.summary) && (
              <p className="mt-2 text-sm text-muted-foreground max-w-2xl line-clamp-4">{stripHtml(p.description)}</p>
            )}
            <div className="flex flex-wrap gap-3 mt-4 items-center text-muted-foreground">
              {p.apple_url && <a href={p.apple_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent text-sm"><Apple className="h-4 w-4" /> Apple</a>}
              {p.spotify_url && <a href={p.spotify_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent text-sm"><Music className="h-4 w-4" /> Spotify</a>}
              {p.youtube_url && <a href={p.youtube_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent text-sm"><Youtube className="h-4 w-4" /> YouTube</a>}
              {p.website_url && <a href={p.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent text-sm"><Globe className="h-4 w-4" /> Website</a>}
              <SharePanel title={p.display_title || p.title} />
            </div>
          </div>
        </div>

        <h2 className="text-xl font-semibold mt-10 mb-4">Episodes</h2>
        {eps.length === 0 ? (
          <div className="text-muted-foreground">No episodes yet.</div>
        ) : (
          <ul className="divide-y divide-border border border-border rounded-lg bg-card">
            {eps.map((e) => {
              const fr = freshnessOf(e.published_at);
              return (
                <li key={e.id} className="p-4 hover:bg-secondary/50">
                  <Link to={`/podcast/${p.slug}/${e.slug}`} className="block">
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      {e.display_title || e.title}
                      {fr === "new" && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-primary/40 bg-primary/15 text-[10px] font-semibold text-primary">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> NEW
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-2 items-center">
                      {e.published_at && <span title={new Date(e.published_at).toLocaleString()}>{relativeTime(e.published_at)}</span>}
                    </div>
                    {(e.summary || e.description) && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{snippet(e.summary || e.description, 200)}</p>
                    )}
                  </Link>
                  {e.audio_url && (
                    <a href={e.audio_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-foreground inline-block mt-2">↗ Listen</a>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <SimilarPodcasts podcastId={p.id} />
      </div>
    </Layout>
  );
}
