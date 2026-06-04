import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import NotFoundState from "@/components/NotFoundState";
import { compareByScore } from "@/lib/episodeRank";
import PersonAvatar from "@/components/PersonAvatar";
import { matchesEntitySlug } from "@/lib/entity";
import { snippet } from "@/lib/text";
import { isUsefulPersonIdentityLabel } from "@/components/PersonCard";

interface Person {
  id: string; name: string; slug: string;
  ai_bio: string | null; short_bio: string | null;
  ai_bio_status: string | null;
  overview_text: string | null;
  wikipedia_url: string | null; wikipedia_title: string | null;
  wikipedia_match_status: string | null;
  wikipedia_match_confidence?: number | null;
  wikipedia_extract: string | null;
  wikipedia_description: string | null;
  short_description_hu: string | null;
  image_url: string | null;
  image_original_url: string | null;
  image_attribution: string | null;
  image_license: string | null;
  episode_count: number; podcast_count: number;
  is_indexable: boolean;
  latest_episode_at: string | null;
  disambiguation_label: string | null;
  disambiguation_context: string | null;
  identity_ambiguous?: boolean | null;
  manual_approved?: boolean | null;
  ai_bio_confidence?: number | null;
}

function hasVerifiedWiki(person: Pick<Person, "wikipedia_match_status">): boolean {
  return person.wikipedia_match_status === "verified";
}

function isAmbiguousWithoutTrustedIdentity(person: Person): boolean {
  if (!person.identity_ambiguous) return false;
  if (person.manual_approved) return false;
  if (hasVerifiedWiki(person) && Number(person.wikipedia_match_confidence || 0) >= 0.8) return false;
  return true;
}

function personCollectionIntro(name: string, count: number): string {
  if (count > 0) {
    return `${name} kapcsolódó magyar podcast epizódjai egy helyen: beszélgetések, interjúk és említések a Podiverzum katalógusából.`;
  }
  return `${name} kapcsolódó magyar podcast epizódjai hamarosan megjelennek a Podiverzum katalógusában.`;
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
  const decodedSlug = useMemo(() => decodeURIComponent(slug), [slug]);
  const [person, setPerson] = useState<Person | null>(null);
  const [eps, setEps] = useState<(EpisodeLite & { mention_type?: string; role_type?: string })[]>([]);
  const [related, setRelated] = useState<{ slug: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      setNotFound(false);
      const { data: p } = await supabase
        .from("people")
        .select("id, name, slug, ai_bio, ai_bio_status, ai_bio_confidence, short_bio, overview_text, wikipedia_url, wikipedia_title, wikipedia_match_status, wikipedia_match_confidence, wikipedia_extract, wikipedia_description, short_description_hu, image_url, image_original_url, image_attribution, image_license, episode_count, podcast_count, is_indexable, is_public, latest_episode_at, activation_status, ai_recommended_action, ai_review_status, disambiguation_label, disambiguation_context, identity_status, identity_ambiguous, manual_approved, is_deceased, is_historical, has_archival_evidence, persona, is_topic_only, topic_figure_seeded, topic_figure_origin")
        .eq("slug", slug)
        .maybeSingle();
      const pp: any = p;
      const blocked = !pp || !pp.is_public || pp.activation_status === "inactive"
        || ["hide","reject"].includes(pp.ai_recommended_action || "")
        || ["needs_human_review","duplicate_candidate"].includes(pp.ai_review_status || "")
        || ["split_resolved"].includes(pp.identity_status || "");
      if (blocked) {
        const selectCols = "id, title, slug, published_at, ai_summary, summary, description, audio_url, topics, people, mentioned, companies, tickers, podcast_id, podcasts!inner(slug, title, display_title, image_url, category, podiverzum_rank, rank_label, rss_status, featured, is_hungarian, language_decision)";
        const { data: fallbackRows } = await supabase
          .from("episodes")
          .select(selectCols)
          .or("people.not.is.null,mentioned.not.is.null")
          .eq("podcasts.language_decision", "accept_hungarian")
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(1600);

        const podMap = new Map<string, any>();
        let exemplar = decodedSlug;
        const fallbackEps: any[] = [];
        (fallbackRows || []).forEach((e: any) => {
          const people = (e.people || []) as string[];
          const mentioned = (e.mentioned || []) as string[];
          const participantHit = people.find((v) => matchesEntitySlug("person", v, decodedSlug));
          const mentionedHit = mentioned.find((v) => matchesEntitySlug("person", v, decodedSlug));
          const hit = participantHit || mentionedHit;
          if (!hit) return;
          if (exemplar === decodedSlug) exemplar = hit;
          fallbackEps.push({
            ...e,
            mention_type: participantHit ? "participant" : "mention",
            role_type: participantHit ? "participant" : "mention",
          });
          if (e.podcasts) podMap.set(e.podcast_id, e.podcasts);
        });

        if (!fallbackEps.length) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        const sorted = fallbackEps.sort(compareByScore);
        setPerson({
          id: `fallback-${decodedSlug}`,
          name: exemplar,
          slug: decodedSlug,
          ai_bio: null,
          short_bio: null,
          ai_bio_status: null,
          overview_text: null,
          wikipedia_url: null,
          wikipedia_title: null,
          wikipedia_match_status: null,
          wikipedia_extract: null,
          wikipedia_description: null,
          short_description_hu: null,
          image_url: null,
          image_original_url: null,
          image_attribution: null,
          image_license: null,
          episode_count: sorted.length,
          podcast_count: podMap.size,
          is_indexable: sorted.length >= 5,
          latest_episode_at: sorted[0]?.published_at || null,
          disambiguation_label: null,
          disambiguation_context: null,
          identity_ambiguous: false,
          manual_approved: false,
          ai_bio_confidence: null,
          wikipedia_match_confidence: null,
        });
        setEps(sorted.slice(0, 40) as any);
        setRelated([]);
        setLoading(false);

        const pageUrl = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
        setSeo({
          title: `${exemplar} podcast epizódok, interjúk és említések | Podiverzum`,
          description: `${exemplar} témájú magyar podcast epizódok, beszélgetések, interjúk és említések egy helyen.`,
          canonical: pageUrl,
          noindex: sorted.length < 5,
          jsonLd: sorted.length < 5 ? undefined : [
            {
              "@context": "https://schema.org",
              "@type": "CollectionPage",
              name: `${exemplar} podcast epizódok`,
              url: pageUrl,
            },
          ],
        });
        return;
      }
      setPerson(p as any);

      const { data: mentions } = await supabase
        .from("person_episode_mentions")
        .select("episode_id, podcast_id, mention_type, role_type, confidence, relevance_status, final_relevance_score, validation_source, episodes!inner(id, title, slug, published_at, ai_summary, summary, description, audio_url, topics, people, mentioned, companies, tickers, podcast_id, podcasts!inner(slug, title, display_title, image_url, category, podiverzum_rank, rank_label, rss_status, featured, is_hungarian, language_decision))")
        .eq("person_id", (p as any).id)
        .eq("episodes.podcasts.language_decision", "accept_hungarian")
        .limit(500);

      const epList: any[] = [];
      const podMap = new Map<string, any>();
      (mentions || []).forEach((m: any) => {
        if (!m.episodes) return;
        const accepted = m.relevance_status === "accepted";
        const strongAi = Number(m.final_relevance_score || 0) >= 0.75;
        const manual = m.validation_source === "manual";
        const legacyOk = (!m.relevance_status || m.relevance_status === "pending")
          && ["host","guest","subject","archival_source","interviewee","speaker"].includes(m.mention_type)
          && Number(m.confidence || 0) >= 0.80;
        if (m.relevance_status === "rejected" || m.relevance_status === "needs_review") return;
        if (!(accepted || strongAi || manual || legacyOk)) return;
        // Derive role_type if missing (defensive — backfilled in DB but new rows might not have it yet)
        let roleType = m.role_type as string | null;
        if (!roleType) {
          if (["host","guest","interviewee","speaker","archival_source"].includes(m.mention_type)) roleType = "participant";
          else if (m.mention_type === "subject") roleType = "subject";
          else roleType = "mention";
        }
        epList.push({ ...m.episodes, mention_type: m.mention_type, role_type: roleType });
        if (m.episodes.podcasts) podMap.set(m.episodes.podcast_id, m.episodes.podcasts);
      });
      setEps(epList.sort(compareByScore) as any);

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
          .select("slug, name, is_indexable, activation_status, ai_recommended_action, ai_review_status, identity_status, identity_ambiguous, manual_approved, wikipedia_match_status, wikipedia_match_confidence")
          .eq("is_public", true)
          .eq("is_indexable", true)
          .in("name", topNames);
        const safeRelated = ((rel || []) as any[]).filter((r) => {
          const trustedWiki = r.wikipedia_match_status === "verified" && Number(r.wikipedia_match_confidence || 0) >= 0.8;
          if (r.activation_status === "inactive") return false;
          if (["hide", "reject"].includes(r.ai_recommended_action || "")) return false;
          if (["needs_human_review", "duplicate_candidate"].includes(r.ai_review_status || "")) return false;
          if (r.identity_status === "split_resolved") return false;
          if (r.identity_ambiguous && !r.manual_approved && !trustedWiki) return false;
          return true;
        });
        setRelated(safeRelated.map((r) => ({ slug: r.slug, name: r.name })) as any);
      }

      setLoading(false);

      const pageUrl = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
      const verifiedWiki = (p as any).wikipedia_match_status === "verified" && Number((p as any).wikipedia_match_confidence || 0) >= 0.8;
      const safeDesc = `${(p as any).name} témájú magyar podcast epizódok, beszélgetések, interjúk és említések egy helyen. Fedezd fel a kapcsolódó műsorokat a Podiverzumon.`;
      const thinPage = epList.length < 2;

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
          description: safeDesc,
          url: pageUrl,
          sameAs: (p as any).wikipedia_url ? [(p as any).wikipedia_url] : undefined,
        });
      } else {
        jsonLd.unshift({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: `${(p as any).name} podcast epizódok`,
          url: pageUrl,
        });
      }

      const personName = (p as any).name;
      const epCount = epList.length;
      const epLabel = epCount > 0 ? ` – ${epCount} podcast epizódban hallható` : "";
      const descBase = safeDesc;
      const descSuffix = epCount > 0 ? ` Megnézhető ${epCount} podcast epizód, amelyben ${personName} szerepel.` : "";
      const fullDesc = `${descBase}${descSuffix}`.trim();
      setSeo({
        title: `${personName}${epLabel} | Podiverzum`,
        description: fullDesc.length > 160 ? fullDesc.slice(0, 157).trimEnd() + "…" : fullDesc,
        canonical: pageUrl,
        noindex: !(p as any).is_indexable || thinPage,
        jsonLd: (!(p as any).is_indexable || thinPage) ? undefined : jsonLd,
      });
    })();
  }, [slug, decodedSlug]);

  const isHistorical = Boolean((person as any)?.is_deceased || (person as any)?.is_historical);
  const hasArchival = Boolean((person as any)?.has_archival_evidence);

  const segments = useMemo(() => {
    // Three canonical role groups per episode, sourced from role_type.
    const archival = eps.filter(e => e.mention_type === "archival_source");
    // Historical rule: a deceased/historical person is NEVER labelled "vendég/interjúalany"
    // unless the episode has explicit archival_source evidence. Fold non-archival
    // participant rows into the subject bucket.
    const rawParticipants = eps.filter(e => e.role_type === "participant");
    const participants = isHistorical
      ? rawParticipants.filter(e => e.mention_type === "archival_source")
      : rawParticipants;
    const subjectsBase = eps.filter(e => e.role_type === "subject");
    const subjects = isHistorical
      ? [
          ...subjectsBase,
          ...rawParticipants.filter(e => e.mention_type !== "archival_source"),
        ]
      : subjectsBase;
    const mentions = eps.filter(e => e.role_type === "mention");
    return { participants, subjects, mentions, archival };
  }, [eps, isHistorical]);

  const last30 = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    return eps.filter(e => e.published_at && new Date(e.published_at).getTime() >= cutoff).length;
  }, [eps]);

  if (loading) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Betöltés…</div></Layout>;
  if (notFound || !person) return <NotFoundState title="Nincs ilyen személy" message="A keresett személy nem található vagy még nem nyilvános." />;

  const hasParticipants = segments.participants.length > 0;
  const hasSubjects = segments.subjects.length > 0;
  const hasMentions = segments.mentions.length > 0;
  const hasArchivalSection = segments.archival.length > 0;
  const distinctSections = [hasParticipants, hasSubjects, hasMentions, hasArchivalSection].filter(Boolean).length;
  const useDistinct = distinctSections >= 2;
  const introText = personCollectionIntro(person.name, eps.length);
  const avatarUrl = isAmbiguousWithoutTrustedIdentity(person)
    ? null
    : person.image_url || person.image_original_url || null;
  const identityLabel = isUsefulPersonIdentityLabel(person.disambiguation_label)
    ? person.disambiguation_label
    : null;

  const pCount = segments.participants.length;
  const sCount = segments.subjects.length;
  const mCount = segments.mentions.length;
  const dominantRole: "participant" | "subject" | "mention" | null =
    pCount === 0 && sCount === 0 && mCount === 0
      ? null
      : pCount >= Math.max(sCount, mCount)
        ? "participant"
        : sCount >= mCount
          ? "subject"
          : "mention";
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
            <PersonAvatar name={person.name} size="xl" imageUrl={avatarUrl} />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Podcastokban</div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mt-2">{person.name}</h1>
              {identityLabel && (
                <div className="text-sm text-muted-foreground mt-1">{identityLabel}</div>
              )}
              <p className="text-foreground/85 mt-3 max-w-2xl leading-relaxed">{snippet(introText, 320)}</p>
              {avatarUrl && person.image_license && (
                <div className="text-xs text-muted-foreground mt-3 flex flex-wrap gap-x-3 gap-y-1">
                  <span>Fotó: {person.image_attribution || "Wikimedia Commons"}</span>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5 max-w-xl">
                <StatCard label="Indexelt epizódok" value={eps.length} />
                <StatCard label="Elmúlt 30 nap" value={last30} />
                <StatCard label="Podcastok" value={new Set(eps.map((e: any) => e.podcast_id)).size} />
                <StatCard label="Legutóbbi említés" value={eps[0]?.published_at ? new Date(eps[0].published_at).toLocaleDateString("hu-HU") : (person.latest_episode_at ? new Date(person.latest_episode_at).toLocaleDateString("hu-HU") : "—")} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl space-y-12">
        {eps.length === 0 && <div className="text-muted-foreground">Még nincs releváns epizód.</div>}

        {isHistorical && (
          <div className="text-xs text-muted-foreground -mt-6">
            Történelmi / már nem élő személy — az epizódok róla szólnak, illetve megemlítik. A „vendég" vagy „interjúalany" jelölést szándékosan nem használjuk archív forrásbizonyíték nélkül.
          </div>
        )}

        {useDistinct ? (
          <>
            {/* Sorted by ranking priority: participant > subject > mention */}
            {hasParticipants && (
              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {isHistorical ? "Archív megszólalások" : "Szereplései és megszólalásai"}
                </h2>
                {!isHistorical && (
                  <p className="text-xs text-muted-foreground mb-3">
                    Epizódok, ahol vendég, házigazda, interjúalany vagy szereplő.
                  </p>
                )}
                <EpisodeList items={segments.participants.slice(0, 20)} showEntities />
              </section>
            )}
            {hasSubjects && (
              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {isHistorical
                    ? `${person.name} életművéről szóló adások`
                    : `Róla szóló adások`}
                </h2>
                <p className="text-xs text-muted-foreground mb-3">
                  Adások, amelyekben {person.name} témaként szerepel — elemzések, beszélgetések a munkájáról, szerepéről, hatásáról.
                </p>
                <EpisodeList items={segments.subjects.slice(0, 20)} showEntities />
              </section>
            )}
            {hasMentions && (
              <section>
                <h2 className="text-xl font-semibold mb-3">Említések</h2>
                <p className="text-xs text-muted-foreground mb-3">
                  Epizódok, amelyek kontextusként említik {person.name} nevét.
                </p>
                <EpisodeList items={segments.mentions.slice(0, 20)} showEntities />
              </section>
            )}
            {hasArchivalSection && hasArchival && !isHistorical && (
              <section>
                <h2 className="text-xl font-semibold mb-3">Archív megszólalások</h2>
                <p className="text-xs text-muted-foreground mb-3">Eredeti felvétel vagy archív hanganyag az epizódban.</p>
                <EpisodeList items={segments.archival.slice(0, 20)} showEntities />
              </section>
            )}
          </>
        ) : (
          eps.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-3">
                {isHistorical
                  ? `${person.name} témaként`
                  : dominantRole === "participant" ? "Szereplései és megszólalásai"
                  : dominantRole === "subject" ? "Róla szóló adások"
                  : "Említések"}
              </h2>
              <EpisodeList items={eps.slice(0, 30)} showEntities />
            </section>
          )
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
