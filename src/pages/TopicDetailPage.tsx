import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import NotFoundState from "@/components/NotFoundState";
import { compareByScore, episodeScore } from "@/lib/episodeRank";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";

interface Topic {
  id: string; slug: string; name: string; short_name: string | null;
  seo_title: string | null; seo_description: string | null;
  h1: string | null; intro_text: string | null;
  episode_count: number; podcast_count: number; is_indexable: boolean;
  domain: string | null;
}

function isUnsafeTemporalPerson(person: any): boolean {
  if (!person || person.has_archival_evidence === true || person.manual_approved === true) return false;
  if (person.is_deceased === true || person.is_historical === true || person.persona === "historical") return true;
  if (person.date_of_death || person.is_living === false) return true;
  return false;
}

// Merged/renamed topics → canonical slugs (301-style client redirect)
const SLUG_REDIRECTS: Record<string, string> = {
  ai: "mesterseges-intelligencia",
  foci: "labdarugas",
  futball: "labdarugas",
};

export default function TopicDetailPage() {
  const { slug: rawSlug = "" } = useParams();
  const nav = useNavigate();
  const slug = SLUG_REDIRECTS[rawSlug] || rawSlug;
  const [topic, setTopic] = useState<Topic | null>(null);
  const [eps, setEps] = useState<EpisodeLite[]>([]);
  const [related, setRelated] = useState<Topic[]>([]);
  const [people, setPeople] = useState<{ slug: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (rawSlug && SLUG_REDIRECTS[rawSlug]) {
      nav(`/temak/${SLUG_REDIRECTS[rawSlug]}`, { replace: true });
      return;
    }
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

      // Episodes mapped to topic, HU-gated. Prefer judge-accepted reviews; union with
      // remaining episode_topic_map rows that have NOT been rejected by the judge.
      const topicId = (t as any).id;
      const epSelect = "id, title, display_title, slug, image_url, published_at, ai_summary, summary, description, audio_url, topics, people, mentioned, podcast_id, podcasts!inner(slug, title, display_title, image_url, category, podiverzum_rank, rank_label, rss_status, featured, language_decision)";

      const [{ data: reviewRows }, { data: mapRows }, { data: rejectedRows }, { data: classRows }] = await Promise.all([
        supabase
          .from("episode_topic_relevance_reviews")
          .select(`episode_id, confidence, episodes!inner(${epSelect})`)
          .eq("topic_id", topicId)
          .eq("status", "accepted")
          .eq("episodes.podcasts.language_decision", "accept_hungarian")
          .limit(200),
        supabase
          .from("episode_topic_map")
          .select(`episode_id, confidence, episodes!inner(${epSelect})`)
          .eq("topic_id", topicId)
          .eq("episodes.podcasts.language_decision", "accept_hungarian")
          .limit(200),
        supabase
          .from("episode_topic_relevance_reviews")
          .select("episode_id")
          .eq("topic_id", topicId)
          .eq("status", "rejected"),
        supabase
          .from("episode_ai_classifications")
          .select(`episode_id, topics, classification_status, confidence, episodes!inner(${epSelect})`)
          .eq("classification_status", "classified")
          .contains("topics", JSON.stringify([{ slug }]) as any)
          .eq("episodes.podcasts.language_decision", "accept_hungarian")
          .limit(200),
      ]);
      const rejectedSet = new Set((rejectedRows || []).map((r: any) => r.episode_id));
      const byId = new Map<string, any>();
      // Highest trust first: explicit judge accepts
      for (const r of (reviewRows || [])) {
        const e: any = (r as any).episodes;
        if (e && !rejectedSet.has(e.id)) byId.set(e.id, e);
      }
      // Then: episode-level AI classification with topic confidence >= 0.6
      for (const r of (classRows || [])) {
        const e: any = (r as any).episodes;
        if (!e || rejectedSet.has(e.id) || byId.has(e.id)) continue;
        const topicArr = (r as any).topics as Array<{ slug: string; confidence: number }>;
        const hit = topicArr?.find((t) => t.slug === slug);
        if (hit && (hit.confidence ?? 0) >= 0.6) byId.set(e.id, e);
      }
      // Weak fallback: legacy episode_topic_map (only if not rejected)
      for (const r of (mapRows || [])) {
        const e: any = (r as any).episodes;
        if (e && !rejectedSet.has(e.id) && !byId.has(e.id)) byId.set(e.id, e);
      }
      const epList: any[] = [...byId.values()];
      setEps(epList.sort(compareByScore).slice(0, 40) as any);

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
          .select("slug, name, is_indexable, activation_status, ai_recommended_action, ai_review_status, identity_status, identity_ambiguous, manual_approved, wikipedia_match_status, wikipedia_match_confidence, is_deceased, is_historical, has_archival_evidence, persona, is_topic_only, date_of_death, is_living, participant_count, host_count, guest_count")
          .eq("is_public", true)
          .eq("is_indexable", true)
          .in("name", topNames);
        const safePeople = ((ppl || []) as any[]).filter((p) => {
          const trustedWiki = p.wikipedia_match_status === "verified" && Number(p.wikipedia_match_confidence || 0) >= 0.8;
          if (p.activation_status === "inactive") return false;
          if (["hide", "reject"].includes(p.ai_recommended_action || "")) return false;
          if (["needs_human_review", "duplicate_candidate"].includes(p.ai_review_status || "")) return false;
          if (p.identity_status === "split_resolved") return false;
          if (isUnsafeTemporalPerson(p)) return false;
          if (p.identity_ambiguous && !p.manual_approved && !trustedWiki) return false;
          return true;
        });
        setPeople(safePeople.map((p) => ({ slug: p.slug, name: p.name })) as any);
      }

      setLoading(false);

      const pageUrl = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
      const topicName = (t as any).name;
      const epCount = Number((t as any).episode_count || 0);
      const podCount = Number((t as any).podcast_count || 0);
      const countLabel = epCount > 0 ? ` – ${epCount} podcast epizód` : "";
      const introClean = sanitizeHungarianPublicText((t as any).intro_text);
      const fallbackDesc = `${topicName} témájú magyar podcast epizódok és beszélgetések${podCount > 0 ? `, ${podCount} műsorból` : ""}. Fedezd fel a kapcsolódó tartalmakat a Podiverzumon.`;
      const descSource = sanitizeHungarianPublicText((t as any).seo_description) || introClean || fallbackDesc;
      const titleSource = `${topicName}${countLabel} magyar podcastokból | Podiverzum`;
      setSeo({
        title: titleSource,
        description: descSource.length > 160 ? descSource.slice(0, 157).trimEnd() + "…" : descSource,
        canonical: pageUrl,
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
              { "@type": "Question", name: `Milyen magyar podcast epizódok foglalkoznak ${(t as any).name} témával?`, acceptedAnswer: { "@type": "Answer", text: `Jelenleg ${(t as any).episode_count} magyar podcast epizódot indexelünk ehhez a témához.` } },
              { "@type": "Question", name: `Hol találok friss ${(t as any).name} podcast epizódokat?`, acceptedAnswer: { "@type": "Answer", text: "A Podiverzum naponta frissül, az új epizódok automatikusan megjelennek a témaoldalon." } },
              { "@type": "Question", name: "Hogyan válogatja a Podiverzum ezeket az epizódokat?", acceptedAnswer: { "@type": "Answer", text: "Kulcsszavak, MI-elemzés és a műsorok minősége alapján rangsorolunk." } },
            ],
          },
        ],
      });
    })();
  }, [slug, rawSlug]);

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
        {eps.length === 0 && (
          <div className="text-muted-foreground">Még gyűjtjük az epizódokat ehhez a témához.</div>
        )}
      </div>
    </Layout>
  );
}
