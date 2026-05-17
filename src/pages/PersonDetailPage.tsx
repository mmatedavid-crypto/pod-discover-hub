import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import NotFoundState from "@/components/NotFoundState";
import { compareByScore } from "@/lib/episodeRank";

interface Person {
  id: string; name: string; slug: string;
  ai_bio: string | null; short_bio: string | null;
  overview_text: string | null;
  image_url: string | null; image_attribution: string | null;
  image_author: string | null; image_license: string | null; image_license_url: string | null;
  image_original_url: string | null; image_status: string | null;
  wikipedia_url: string | null; wikipedia_title: string | null;
  wikipedia_match_status: string | null;
  episode_count: number; podcast_count: number;
  is_indexable: boolean;
  latest_episode_at: string | null;
}

function Initials({ name, size = 112 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join("");
  return (
    <div style={{ width: size, height: size }} className="rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border border-border flex items-center justify-center text-3xl font-semibold text-foreground/80 shrink-0">
      {initials || "?"}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

export default function PersonDetailPage() {
  const { slug = "" } = useParams();
  const [person, setPerson] = useState<Person | null>(null);
  const [eps, setEps] = useState<(EpisodeLite & { mention_type?: string })[]>([]);
  const [pods, setPods] = useState<PodcastLite[]>([]);
  const [related, setRelated] = useState<{ slug: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      const { data: p } = await supabase
        .from("people")
        .select("id, name, slug, ai_bio, short_bio, overview_text, image_url, image_attribution, image_author, image_license, image_license_url, image_original_url, image_status, wikipedia_url, wikipedia_title, wikipedia_match_status, episode_count, podcast_count, is_indexable, is_public, latest_episode_at, activation_status, ai_recommended_action, ai_review_status")
        .eq("slug", slug)
        .maybeSingle();
      const pp: any = p;
      const blocked = !pp || !pp.is_public || pp.activation_status === "inactive"
        || ["hide","reject"].includes(pp.ai_recommended_action || "")
        || ["needs_human_review","duplicate_candidate"].includes(pp.ai_review_status || "");
      if (blocked) { setNotFound(true); setLoading(false); return; }
      setPerson(p as any);

      const { data: mentions } = await supabase
        .from("person_episode_mentions")
        .select("episode_id, podcast_id, mention_type, confidence, episodes!inner(id, title, slug, published_at, summary, description, audio_url, topics, people, mentioned, companies, tickers, podcast_id, podcasts!inner(slug, title, display_title, image_url, category, podiverzum_rank, rank_label, rss_status, featured, is_hungarian, language_decision))")
        .eq("person_id", (p as any).id)
        .eq("episodes.podcasts.is_hungarian", true)
        .eq("episodes.podcasts.language_decision", "accept_hungarian")
        .limit(300);

      const epList: any[] = [];
      const podMap = new Map<string, any>();
      (mentions || []).forEach((m: any) => {
        if (m.episodes) {
          epList.push({ ...m.episodes, mention_type: m.mention_type });
          if (m.episodes.podcasts) podMap.set(m.episodes.podcast_id, m.episodes.podcasts);
        }
      });
      setEps(epList.sort(compareByScore) as any);

      if (podMap.size > 0) {
        const { data: ps } = await supabase
          .from("podcasts")
          .select("id, title, display_title, slug, summary, description, image_url, category, apple_url, spotify_url, youtube_url, website_url, featured, rss_status, podiverzum_rank")
          .in("id", [...podMap.keys()])
          .eq("is_hungarian", true)
          .eq("language_decision", "accept_hungarian");
        setPods(((ps || []) as any).sort((a: any, b: any) => (b.podiverzum_rank || 0) - (a.podiverzum_rank || 0)).slice(0, 9));
      }

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
        const { data: rel } = await supabase.from("people").select("slug, name").eq("is_public", true).in("name", topNames);
        setRelated((rel || []) as any);
      }

      setLoading(false);

      const pageUrl = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
      const bio = (p as any).ai_bio || (p as any).short_bio;
      const verifiedWiki = (p as any).wikipedia_match_status === "verified";
      const safeDesc = `${(p as any).name} témájú magyar podcast epizódok, beszélgetések, interjúk és említések egy helyen. Fedezd fel a kapcsolódó műsorokat a Podiverzumon.`;

      const jsonLd: any[] = [
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Podiverzum", item: "https://podiverzum.hu/" },
            { "@type": "ListItem", position: 2, name: "Személyek", item: "https://podiverzum.hu/szemelyek" },
            { "@type": "ListItem", position: 3, name: (p as any).name, item: pageUrl },
          ],
        },
      ];
      if (verifiedWiki) {
        jsonLd.unshift({
          "@context": "https://schema.org",
          "@type": "Person",
          name: (p as any).name,
          description: bio || undefined,
          url: pageUrl,
          sameAs: (p as any).wikipedia_url ? [(p as any).wikipedia_url] : undefined,
          image: (p as any).image_url || undefined,
        });
      } else {
        jsonLd.unshift({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: `${(p as any).name} podcast epizódok`,
          url: pageUrl,
        });
      }

      setSeo({
        title: `${(p as any).name} podcast epizódok, interjúk és említések | Podiverzum`,
        description: bio?.slice(0, 160) || safeDesc,
        noindex: !(p as any).is_indexable,
        image: (p as any).image_url || undefined,
        jsonLd: !(p as any).is_indexable ? undefined : jsonLd,
      });
    })();
  }, [slug]);

  const segments = useMemo(() => {
    const interviews = eps.filter(e => e.mention_type === "host" || e.mention_type === "guest");
    const subjects = eps.filter(e => e.mention_type === "subject");
    const mentioned = eps.filter(e => e.mention_type === "mentioned");
    return { interviews, subjects, mentioned };
  }, [eps]);

  const last30 = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    return eps.filter(e => e.published_at && new Date(e.published_at).getTime() >= cutoff).length;
  }, [eps]);

  if (loading) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Betöltés…</div></Layout>;
  if (notFound || !person) return <NotFoundState title="Nincs ilyen személy" message="A keresett személy nem található vagy még nem nyilvános." />;

  const hasInterviews = segments.interviews.length > 0;
  const hasSubjects = segments.subjects.length > 0;
  const hasMentioned = segments.mentioned.length > 0;
  const distinctSections = [hasInterviews, hasSubjects, hasMentioned].filter(Boolean).length;
  const useDistinct = distinctSections >= 2;
  const attributionText = person.image_status === "cached" && (person.image_author || person.image_attribution || person.image_license)
    ? `Kép: ${person.image_author || person.image_attribution || ""}${person.image_license ? `, ${person.image_license}` : ""}`.trim()
    : null;

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 max-w-5xl">
          <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Podiverzum</Link> ›{" "}
            <Link to="/szemelyek" className="hover:text-foreground">Személyek</Link> ›{" "}
            <span className="text-foreground">{person.name}</span>
          </nav>
          <div className="flex flex-col sm:flex-row items-start gap-6">
            <div className="flex flex-col items-start gap-2">
              {person.image_url ? (
                <img src={person.image_url} alt={person.name} width={112} height={112} loading="lazy" className="h-28 w-28 rounded-full object-cover border border-border" />
              ) : <Initials name={person.name} />}
              {attributionText && (
                <button onClick={() => setShowSource(s => !s)} className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                  Képforrás
                </button>
              )}
              {showSource && attributionText && (
                <p className="text-[10px] text-muted-foreground max-w-[12rem] leading-tight">
                  {attributionText}
                  {person.image_license_url && <> · <a href={person.image_license_url} target="_blank" rel="noopener noreferrer nofollow" className="underline">licenc</a></>}
                  {person.image_original_url && <> · <a href={person.image_original_url} target="_blank" rel="noopener noreferrer nofollow" className="underline">forrás</a></>}
                </p>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Személy</div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mt-2">{person.name}</h1>
              {(person.ai_bio || person.short_bio) && (
                <p className="text-foreground/85 mt-3 max-w-2xl leading-relaxed">{person.ai_bio || person.short_bio}</p>
              )}
              {person.wikipedia_url && person.wikipedia_match_status === "verified" && (
                <a href={person.wikipedia_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline mt-3 inline-block">Wikipedia: {person.wikipedia_title} →</a>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5 max-w-xl">
                <StatCard label="Indexelt epizódok" value={person.episode_count || eps.length} />
                <StatCard label="Elmúlt 30 nap" value={last30} />
                <StatCard label="Podcastok" value={person.podcast_count || pods.length} />
                <StatCard label="Legutóbbi említés" value={person.latest_episode_at ? new Date(person.latest_episode_at).toLocaleDateString("hu-HU") : "—"} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl space-y-12">
        {person.overview_text && (
          <section className="rounded-xl border border-border bg-card/50 p-5">
            <h2 className="text-lg font-semibold mb-2">Áttekintés</h2>
            <p className="text-foreground/85 leading-relaxed">{person.overview_text}</p>
            <p className="text-[11px] text-muted-foreground mt-3">Az indexelt epizódok alapján generálva.</p>
          </section>
        )}

        {eps.length === 0 && <div className="text-muted-foreground">Még nincs releváns epizód.</div>}

        {useDistinct ? (
          <>
            {hasInterviews && (
              <section>
                <h2 className="text-xl font-semibold mb-3">Interjúk és szereplések</h2>
                <EpisodeList items={segments.interviews.slice(0, 20)} showEntities />
              </section>
            )}
            {hasSubjects && (
              <section>
                <h2 className="text-xl font-semibold mb-3">Epizódok {person.name} témájában</h2>
                <EpisodeList items={segments.subjects.slice(0, 20)} showEntities />
              </section>
            )}
            {hasMentioned && (
              <section>
                <h2 className="text-xl font-semibold mb-3">Említések</h2>
                <EpisodeList items={segments.mentioned.slice(0, 20)} showEntities />
              </section>
            )}
          </>
        ) : (
          eps.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-3">Kapcsolódó epizódok</h2>
              <EpisodeList items={eps.slice(0, 30)} showEntities />
            </section>
          )
        )}

        {pods.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Kapcsolódó podcastok</h2>
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
