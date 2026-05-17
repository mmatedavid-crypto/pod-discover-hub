import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import NotFoundState from "@/components/NotFoundState";
import { compareByScore, episodeScore } from "@/lib/episodeRank";

interface Person {
  id: string; name: string; slug: string;
  ai_bio: string | null; short_bio: string | null;
  image_url: string | null; image_attribution: string | null;
  wikipedia_url: string | null;
  episode_count: number; podcast_count: number;
  is_indexable: boolean;
}

function Initials({ name, size = 96 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join("");
  return (
    <div style={{ width: size, height: size }} className="rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border border-border flex items-center justify-center text-2xl font-semibold text-foreground/80">
      {initials || "?"}
    </div>
  );
}

export default function PersonDetailPage() {
  const { slug = "" } = useParams();
  const [person, setPerson] = useState<Person | null>(null);
  const [eps, setEps] = useState<EpisodeLite[]>([]);
  const [pods, setPods] = useState<PodcastLite[]>([]);
  const [related, setRelated] = useState<{ slug: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      const { data: p } = await supabase
        .from("people")
        .select("id, name, slug, ai_bio, short_bio, image_url, image_attribution, wikipedia_url, episode_count, podcast_count, is_indexable, is_public")
        .eq("slug", slug)
        .maybeSingle();
      if (!p || !(p as any).is_public) { setNotFound(true); setLoading(false); return; }
      setPerson(p as any);

      // Mentions
      const { data: mentions } = await supabase
        .from("person_episode_mentions")
        .select("episode_id, podcast_id, mention_type, confidence, episodes!inner(id, title, slug, published_at, summary, description, audio_url, topics, people, mentioned, companies, tickers, podcast_id, podcasts!inner(slug, title, display_title, image_url, category, podiverzum_rank, rank_label, rss_status, featured, is_hungarian, language_decision))")
        .eq("person_id", (p as any).id)
        .eq("episodes.podcasts.is_hungarian", true)
        .eq("episodes.podcasts.language_decision", "accept_hungarian")
        .limit(200);

      const epList: any[] = [];
      const podMap = new Map<string, any>();
      (mentions || []).forEach((m: any) => {
        if (m.episodes) {
          epList.push(m.episodes);
          if (m.episodes.podcasts) podMap.set(m.episodes.podcast_id, m.episodes.podcasts);
        }
      });
      const sorted = epList.sort(compareByScore);
      setEps(sorted.slice(0, 40) as any);

      if (podMap.size > 0) {
        const { data: ps } = await supabase
          .from("podcasts")
          .select("id, title, display_title, slug, summary, description, image_url, category, apple_url, spotify_url, youtube_url, website_url, featured, rss_status, podiverzum_rank")
          .in("id", [...podMap.keys()])
          .eq("is_hungarian", true)
          .eq("language_decision", "accept_hungarian");
        setPods(((ps || []) as any).sort((a: any, b: any) => (b.podiverzum_rank || 0) - (a.podiverzum_rank || 0)).slice(0, 9));
      }

      // Related people via co-occurrence in same episodes
      const tally = new Map<string, number>();
      epList.forEach((e: any) => {
        [...(e.people || []), ...(e.mentioned || [])].forEach((n: string) => {
          if (n.toLowerCase() !== (p as any).name.toLowerCase()) {
            tally.set(n, (tally.get(n) || 0) + 1);
          }
        });
      });
      const topNames = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);
      if (topNames.length > 0) {
        const { data: rel } = await supabase
          .from("people")
          .select("slug, name")
          .eq("is_public", true)
          .in("name", topNames);
        setRelated((rel || []) as any);
      }

      setLoading(false);

      const pageUrl = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
      const bio = (p as any).ai_bio || (p as any).short_bio;
      setSeo({
        title: `${(p as any).name} podcast epizódok, interjúk és említések | Podiverzum`,
        description: bio?.slice(0, 160) || `${(p as any).name} témájú magyar podcast epizódok, beszélgetések, interjúk és említések egy helyen a Podiverzumon.`,
        noindex: !(p as any).is_indexable,
        jsonLd: !(p as any).is_indexable ? undefined : [
          {
            "@context": "https://schema.org",
            "@type": "Person",
            name: (p as any).name,
            description: bio || undefined,
            url: pageUrl,
            sameAs: (p as any).wikipedia_url ? [(p as any).wikipedia_url] : undefined,
            image: (p as any).image_url || undefined,
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Podiverzum", item: "https://podiverzum.hu/" },
              { "@type": "ListItem", position: 2, name: "Személyek", item: "https://podiverzum.hu/szemelyek" },
              { "@type": "ListItem", position: 3, name: (p as any).name, item: pageUrl },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: [
              { "@type": "Question", name: `Ki az a ${(p as any).name}?`, acceptedAnswer: { "@type": "Answer", text: bio || `${(p as any).name} több magyar podcast epizódban is előforduló közéleti vagy szakmai szereplő.` } },
              { "@type": "Question", name: `Milyen podcast epizódokban szerepel vagy kerül szóba ${(p as any).name}?`, acceptedAnswer: { "@type": "Answer", text: `Jelenleg ${(p as any).episode_count} epizódban szerepel ${(p as any).podcast_count} műsorból.` } },
            ],
          },
        ],
      });
    })();
  }, [slug]);

  if (loading) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Betöltés…</div></Layout>;
  if (notFound || !person) return <NotFoundState title="Nincs ilyen személy" message="A keresett személy nem található vagy még nem nyilvános." />;

  const newest = eps.slice().sort((a, b) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime()).slice(0, 12);
  const best = eps.slice().sort((a, b) => episodeScore(b) - episodeScore(a)).slice(0, 12);

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 max-w-5xl">
          <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Podiverzum</Link> ›{" "}
            <Link to="/szemelyek" className="hover:text-foreground">Személyek</Link> ›{" "}
            <span className="text-foreground">{person.name}</span>
          </nav>
          <div className="flex items-start gap-6">
            {person.image_url ? (
              <img src={person.image_url} alt={person.name} width={96} height={96} loading="lazy" className="h-24 w-24 rounded-full object-cover border border-border" />
            ) : <Initials name={person.name} />}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Személy</div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mt-2">{person.name} podcast epizódokban</h1>
              {(person.ai_bio || person.short_bio) && (
                <p className="text-foreground/85 mt-3 max-w-2xl leading-relaxed">{person.ai_bio || person.short_bio}</p>
              )}
              {person.image_attribution && (
                <p className="text-[10px] text-muted-foreground mt-2">Kép: {person.image_attribution}</p>
              )}
              {person.wikipedia_url && (
                <a href={person.wikipedia_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline mt-2 inline-block">Wikipedia →</a>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl space-y-12">
        {eps.length === 0 && (
          <div className="text-muted-foreground">Még nincs releváns epizód.</div>
        )}
        {newest.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Friss epizódok {person.name} témájában</h2>
            <EpisodeList items={newest} showEntities />
          </section>
        )}
        {best.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Időtálló epizódok</h2>
            <EpisodeList items={best} showEntities />
          </section>
        )}
        {pods.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Műsorok, ahol előfordul</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pods.map(p => <PodcastCard key={p.id} p={p} />)}
            </div>
          </section>
        )}
        {related.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Kapcsolódó személyek</h2>
            <div className="flex flex-wrap gap-2">
              {related.map(r => (
                <Link key={r.slug} to={`/szemelyek/${r.slug}`} className="px-3 py-1.5 rounded-full border border-border bg-card text-sm hover:border-primary/50">{r.name}</Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}
