import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import NotFoundState from "@/components/NotFoundState";
import { compareByScore, episodeScore } from "@/lib/episodeRank";

interface Topic {
  id: string; slug: string; name: string; short_name: string | null;
  seo_title: string | null; seo_description: string | null;
  h1: string | null; intro_text: string | null;
  episode_count: number; podcast_count: number; is_indexable: boolean;
  domain: string | null;
}

export default function TopicDetailPage() {
  const { slug = "" } = useParams();
  const nav = useNavigate();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [eps, setEps] = useState<EpisodeLite[]>([]);
  const [pods, setPods] = useState<PodcastLite[]>([]);
  const [related, setRelated] = useState<Topic[]>([]);
  const [people, setPeople] = useState<{ slug: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      const { data: t } = await supabase
        .from("topics")
        .select("id, slug, name, short_name, seo_title, seo_description, h1, intro_text, episode_count, podcast_count, is_indexable, domain, is_public")
        .eq("slug", slug)
        .maybeSingle();
      if (!t || !(t as any).is_public) { setNotFound(true); setLoading(false); return; }
      setTopic(t as any);

      // Episodes mapped to topic, HU-gated via inner join podcasts
      const { data: epRows } = await supabase
        .from("episode_topic_map")
        .select("episode_id, confidence, episodes!inner(id, title, slug, published_at, summary, description, audio_url, topics, people, mentioned, podcast_id, podcasts!inner(slug, title, display_title, image_url, category, podiverzum_rank, rank_label, rss_status, featured, is_hungarian, language_decision))")
        .eq("topic_id", (t as any).id)
        .eq("episodes.podcasts.is_hungarian", true)
        .eq("episodes.podcasts.language_decision", "accept_hungarian")
        .limit(200);
      const epList: any[] = (epRows || []).map((r: any) => r.episodes).filter(Boolean);
      setEps(epList.sort(compareByScore).slice(0, 40) as any);

      // Podcasts mapped to topic
      const { data: podRows } = await supabase
        .from("podcast_topic_map")
        .select("podcast_id, confidence, podcasts!inner(id, title, display_title, slug, summary, description, image_url, category, apple_url, spotify_url, youtube_url, website_url, featured, rss_status, podiverzum_rank, is_hungarian, language_decision)")
        .eq("topic_id", (t as any).id)
        .eq("podcasts.is_hungarian", true)
        .eq("podcasts.language_decision", "accept_hungarian")
        .limit(20);
      const podList: any[] = (podRows || []).map((r: any) => r.podcasts).filter(Boolean);
      setPods(podList.sort((a, b) => (b.podiverzum_rank || 0) - (a.podiverzum_rank || 0)).slice(0, 9));

      // Related topics same domain
      if ((t as any).domain) {
        const { data: rel } = await supabase
          .from("topics")
          .select("id, slug, name, short_name, seo_title, seo_description, h1, intro_text, episode_count, podcast_count, is_indexable, domain")
          .eq("domain", (t as any).domain)
          .neq("id", (t as any).id)
          .eq("is_public", true)
          .order("priority", { ascending: false })
          .limit(8);
        setRelated((rel || []) as any);
      }

      // Related people from episodes
      const nameTally = new Map<string, number>();
      epList.forEach(e => {
        [...(e.people || []), ...(e.mentioned || [])].forEach((n: string) => nameTally.set(n, (nameTally.get(n) || 0) + 1));
      });
      const topNames = [...nameTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);
      if (topNames.length > 0) {
        const { data: ppl } = await supabase
          .from("people")
          .select("slug, name")
          .eq("is_public", true)
          .in("name", topNames);
        setPeople((ppl || []) as any);
      }

      setLoading(false);

      const pageUrl = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
      setSeo({
        title: (t as any).seo_title || `${(t as any).name} podcastok magyarul | Podiverzum`,
        description: (t as any).seo_description || `${(t as any).name} témájú magyar podcast epizódok és beszélgetések.`,
        noindex: !(t as any).is_indexable,
        jsonLd: !(t as any).is_indexable ? undefined : [
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: (t as any).h1 || (t as any).name,
            url: pageUrl,
            about: { "@type": "Thing", name: (t as any).name },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Podiverzum", item: "https://podiverzum.hu/" },
              { "@type": "ListItem", position: 2, name: "Témák", item: "https://podiverzum.hu/temak" },
              { "@type": "ListItem", position: 3, name: (t as any).name, item: pageUrl },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: [
              { "@type": "Question", name: `Milyen magyar podcastok foglalkoznak ${(t as any).name} témával?`, acceptedAnswer: { "@type": "Answer", text: `Jelenleg ${(t as any).podcast_count} magyar podcastot és ${(t as any).episode_count} epizódot indexelünk ehhez a témához.` } },
              { "@type": "Question", name: `Hol találok friss ${(t as any).name} podcast epizódokat?`, acceptedAnswer: { "@type": "Answer", text: "A Podiverzum naponta frissül, az új epizódok automatikusan megjelennek a témaoldalon." } },
              { "@type": "Question", name: "Hogyan válogatja a Podiverzum ezeket az epizódokat?", acceptedAnswer: { "@type": "Answer", text: "Kulcsszavak, AI-elemzés és a műsorok minősége alapján rangsorolunk." } },
            ],
          },
        ],
      });
    })();
  }, [slug]);

  if (loading) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Betöltés…</div></Layout>;
  if (notFound || !topic) return <NotFoundState title="Nincs ilyen téma" message="A keresett téma nem található." />;

  // Pure freshness, with per-podcast cap of 2 in the top section so a single
  // chatty show (e.g. Radnóti, Hangosító) cannot monopolise "Friss epizódok".
  const capPerPodcast = (list: EpisodeLite[], cap: number, take: number) => {
    const seen = new Map<string, number>();
    const out: EpisodeLite[] = [];
    for (const e of list) {
      const pid = (e as any).podcast_id || (e as any).podcasts?.slug || "_";
      const n = seen.get(pid) || 0;
      if (n >= cap) continue;
      seen.set(pid, n + 1);
      out.push(e);
      if (out.length >= take) break;
    }
    return out;
  };
  const byDate = eps.slice().sort((a, b) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime());
  const newest = capPerPodcast(byDate, 2, 12);
  const evergreen = eps.slice().sort((a, b) => episodeScore(b) - episodeScore(a)).slice(0, 12);

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 max-w-5xl">
          <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Podiverzum</Link> ›{" "}
            <Link to="/temak" className="hover:text-foreground">Témák</Link> ›{" "}
            <span className="text-foreground">{topic.name}</span>
          </nav>
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Téma</div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mt-2">{topic.h1 || topic.name}</h1>
          {topic.intro_text && (
            <p className="text-foreground/85 mt-3 max-w-2xl leading-relaxed">{topic.intro_text}</p>
          )}
          <button
            onClick={() => nav(`/kereses?q=${encodeURIComponent(topic.name)}`)}
            className="mt-5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90"
          >
            Keress {topic.name} epizódokat →
          </button>
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl space-y-12">
        {pods.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Kiemelt műsorok</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pods.map(p => <PodcastCard key={p.id} p={p} />)}
            </div>
          </section>
        )}
        {newest.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Friss epizódok</h2>
            <EpisodeList items={newest} showEntities />
          </section>
        )}
        {evergreen.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Időtálló epizódok</h2>
            <EpisodeList items={evergreen} showEntities />
          </section>
        )}
        {people.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Kapcsolódó személyek</h2>
            <div className="flex flex-wrap gap-2">
              {people.map(p => (
                <Link key={p.slug} to={`/szemelyek/${p.slug}`} className="px-3 py-1.5 rounded-full border border-border bg-card text-sm hover:border-primary/50">{p.name}</Link>
              ))}
            </div>
          </section>
        )}
        {related.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Kapcsolódó témák</h2>
            <div className="flex flex-wrap gap-2">
              {related.map(r => (
                <Link key={r.slug} to={`/temak/${r.slug}`} className="px-3 py-1.5 rounded-full border border-border bg-card text-sm hover:border-primary/50">{r.short_name || r.name}</Link>
              ))}
            </div>
          </section>
        )}
        {eps.length === 0 && pods.length === 0 && (
          <div className="text-muted-foreground">Még gyűjtjük az epizódokat ehhez a témához.</div>
        )}
      </div>
    </Layout>
  );
}
