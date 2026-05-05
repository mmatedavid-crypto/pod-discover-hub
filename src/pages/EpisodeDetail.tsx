import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Apple, Music, Youtube, ExternalLink } from "lucide-react";
import { setSeo } from "@/lib/seo";

export default function EpisodeDetail() {
  const { podcastSlug, episodeSlug } = useParams();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!podcastSlug || !episodeSlug) return;
    (async () => {
      const { data: p } = await supabase.from("podcasts").select("*").eq("slug", podcastSlug).single();
      if (!p) return;
      const { data: e } = await supabase.from("episodes").select("*").eq("podcast_id", p.id).eq("slug", episodeSlug).single();
      setData({ p, e });
      if (e) setSeo({
        title: `${e.title} — ${p.title}`,
        description: (e.summary || e.description || `Episode of ${p.title} on Podiverzum.`).slice(0, 160),
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "PodcastEpisode",
          name: e.title,
          description: e.summary || undefined,
          datePublished: e.published_at || undefined,
          partOfSeries: { "@type": "PodcastSeries", name: p.title },
          associatedMedia: e.audio_url ? { "@type": "MediaObject", contentUrl: e.audio_url } : undefined,
        },
      });
    })();
  }, [podcastSlug, episodeSlug]);

  if (!data?.e) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  const { p, e } = data;
  const Tag = ({ items, label }: { items: string[]; label: string }) =>
    items?.length ? (
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{label}</div>
        <div className="flex flex-wrap gap-2">
          {items.map((t: string) => (
            <Link key={t} to={`/search?q=${encodeURIComponent(t)}`} className="px-2.5 py-1 rounded-full bg-secondary text-sm hover:bg-accent hover:text-accent-foreground">
              {t}
            </Link>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <Layout>
      <div className="container mx-auto py-10 max-w-3xl">
        <Link to={`/podcast/${p.slug}`} className="text-sm text-muted-foreground hover:text-accent">← {p.title}</Link>
        <h1 className="text-3xl font-semibold mt-2">{e.title}</h1>
        <div className="text-sm text-muted-foreground mt-1">
          {e.published_at && new Date(e.published_at).toLocaleDateString()}
        </div>

        {e.summary && (
          <div className="mt-6 p-4 rounded-lg border border-border bg-card">
            <div className="text-xs uppercase tracking-wide text-accent mb-1">AI summary</div>
            <p>{e.summary}</p>
          </div>
        )}

        {e.description && (
          <div className="mt-6 prose prose-sm max-w-none text-foreground/90 whitespace-pre-wrap">{e.description}</div>
        )}

        <div className="grid gap-4 mt-8">
          <Tag items={e.topics || []} label="Topics" />
          <Tag items={e.people || []} label="People" />
          <Tag items={e.companies || []} label="Companies" />
          <Tag items={e.tickers || []} label="Tickers" />
          <Tag items={e.ingredients || []} label="Ingredients" />
        </div>

        <div className="flex flex-wrap gap-3 mt-8">
          {e.audio_url && <a href={e.audio_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm"><ExternalLink className="h-4 w-4" /> Listen</a>}
          {e.episode_url && <a href={e.episode_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-secondary text-sm">Episode page</a>}
          {p.apple_url && <a href={p.apple_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-secondary text-sm"><Apple className="h-4 w-4" /> Apple</a>}
          {p.spotify_url && <a href={p.spotify_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-secondary text-sm"><Music className="h-4 w-4" /> Spotify</a>}
          {p.youtube_url && <a href={p.youtube_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-secondary text-sm"><Youtube className="h-4 w-4" /> YouTube</a>}
        </div>
      </div>
    </Layout>
  );
}
