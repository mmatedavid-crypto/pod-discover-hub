import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Apple, Music, Youtube, Globe, Activity, AlertTriangle, Mic, Search, X, Play, Pause, Headphones, CalendarDays, Library, ArrowRight, type LucideIcon } from "lucide-react";
import { PodcastCover } from "@/components/PodcastCover";
import PersonAvatar from "@/components/PersonAvatar";
import { setSeo, ogImageUrl, breadcrumbJsonLd } from "@/lib/seo";
import NotFoundState from "@/components/NotFoundState";
import { stripHtml, snippet } from "@/lib/text";
import { PodcastDetailSkeleton } from "@/components/Skeletons";
import { SimilarPodcasts } from "@/components/SimilarPodcasts";
import { SharePanel } from "@/components/SharePanel";
import { freshnessOf, relativeTime } from "@/lib/freshness";
import { PodcastEntitiesCompact } from "@/components/PodcastEntitiesCompact";
import { topEntitiesFrom } from "@/lib/aggregateEntities";
import { categoryHref, categoryLabel } from "@/lib/categoryLabels";
import { PodcastFollow } from "@/components/PodcastFollow";
import { useSmartPlayer } from "@/components/smart-player/SmartPlayerProvider";
import { detectAudioSource } from "@/lib/playerAudio";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";
import { pickEpisodeDescription } from "@/lib/episodeText";

type HostRow = { id?: string; slug?: string; name: string; image_url?: string | null };

function isSafeHostPerson(p: any): boolean {
  if (!p || p.is_public !== true || p.is_indexable !== true) return false;
  if (!["indexable", "manual_approved", null, undefined].includes(p.activation_status)) return false;
  if (["hide", "reject"].includes(p.ai_recommended_action || "")) return false;
  if (["needs_human_review", "duplicate_candidate"].includes(p.ai_review_status || "")) return false;
  if (p.identity_status === "split_resolved") return false;
  const hasPodcastPersonEvidence = Number(p.participant_count || 0) + Number(p.host_count || 0) + Number(p.guest_count || 0) > 0;
  const temporalTopicOnly = p.has_archival_evidence !== true && p.manual_approved !== true && (
    p.is_deceased === true
    || p.is_historical === true
    || p.persona === "historical"
    || ((p.date_of_death || p.is_living === false) && !hasPodcastPersonEvidence)
  );
  if (temporalTopicOnly) return false;
  const trustedWiki = p.wikipedia_match_status === "verified" && Number(p.wikipedia_match_confidence || 0) >= 0.8;
  if (p.identity_ambiguous && !p.manual_approved && !trustedWiki) return false;
  return true;
}

async function fetchAllEpisodes(podcastId: string) {
  const PAGE = 1000;
  let from = 0;
  const all: any[] = [];
  for (let i = 0; i < 20; i++) {
    const { data, error } = await supabase
      .from("episodes")
      .select("id,title,display_title,slug,published_at,ai_summary,summary,description,audio_url,image_url,episode_url,topics,people,companies,tickers,ingredients")
      .eq("podcast_id", podcastId)
      .order("published_at", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function fetchHosts(podcastId: string, manualNames: string[]): Promise<HostRow[]> {
  const [aiRes, manualRes, mentionsRes] = await Promise.all([
    supabase
      .from("person_podcast_map")
      .select("people:person_id(id, slug, name, image_url, is_public, is_indexable, activation_status, ai_recommended_action, ai_review_status, identity_status, identity_ambiguous, manual_approved, wikipedia_match_status, wikipedia_match_confidence, is_deceased, is_historical, has_archival_evidence, persona, is_topic_only, date_of_death, is_living, participant_count, host_count, guest_count)")
      .eq("podcast_id", podcastId)
      .eq("role", "host"),
    manualNames.length
      ? supabase.from("people").select("id, slug, name, image_url, is_public, is_indexable, activation_status, ai_recommended_action, ai_review_status, identity_status, identity_ambiguous, manual_approved, wikipedia_match_status, wikipedia_match_confidence, is_deceased, is_historical, has_archival_evidence, persona, is_topic_only, date_of_death, is_living, participant_count, host_count, guest_count").in("name", manualNames)
      : Promise.resolve({ data: [] as any[] }),
    // AI per-episode host mentions — aggregate to find recurring hosts
    supabase
      .from("person_episode_mentions")
      .select("person_id, people:person_id(id, slug, name, image_url, is_public, is_indexable, activation_status, ai_recommended_action, ai_review_status, identity_status, identity_ambiguous, manual_approved, wikipedia_match_status, wikipedia_match_confidence, is_deceased, is_historical, has_archival_evidence, persona, is_topic_only, date_of_death, is_living, participant_count, host_count, guest_count)")
      .eq("podcast_id", podcastId)
      .eq("mention_type", "host")
      .limit(2000),
  ]);
  const aiHosts = ((aiRes.data || []) as any[])
    .map((r) => r.people)
    .filter(isSafeHostPerson) as Array<{ id: string; slug: string; name: string; image_url: string | null }>;
  const manualPeople = ((manualRes.data || []) as any[]).filter(isSafeHostPerson) as Array<{ id: string; slug: string; name: string; image_url: string | null }>;

  // Aggregate mentions: only keep people with 2+ host-episodes → clearly the host
  const mentionTally = new Map<string, { count: number; person: any }>();
  for (const row of ((mentionsRes.data || []) as any[])) {
    if (!row.person_id || !isSafeHostPerson(row.people)) continue;
    const cur = mentionTally.get(row.person_id) || { count: 0, person: row.people };
    cur.count++;
    mentionTally.set(row.person_id, cur);
  }
  const mentionHosts = [...mentionTally.values()]
    .filter((v) => v.count >= 2)
    .sort((a, b) => b.count - a.count)
    .map((v) => v.person) as Array<{ id: string; slug: string; name: string; image_url: string | null }>;

  const result: HostRow[] = [];
  const seen = new Set<string>();
  const nameSeen = new Set<string>();
  const pushPerson = (h: { id?: string; slug?: string; name: string; image_url?: string | null }) => {
    if (h.id && seen.has(h.id)) return;
    const nameKey = h.name.toLowerCase();
    if (nameSeen.has(nameKey)) return;
    if (h.id) seen.add(h.id);
    nameSeen.add(nameKey);
    result.push(h as HostRow);
  };
  // Manual first (preserves admin-curated order)
  for (const name of manualNames) {
    const match = manualPeople.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (match) pushPerson(match);
    else pushPerson({ name });
  }
  // AI host (person_podcast_map)
  for (const h of aiHosts) pushPerson(h);
  // AI per-episode mentions (recurring host)
  for (const h of mentionHosts) pushPerson(h);
  return result;
}

export default function PodcastDetail() {
  const { podcastSlug } = useParams();
  const [p, setP] = useState<any>(null);
  const [eps, setEps] = useState<any[]>([]);
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { play } = useSmartPlayer();

  useEffect(() => {
    if (!podcastSlug) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("podcasts").select("*").eq("slug", podcastSlug).maybeSingle();
      const isForeignRejected = (podcast: any) => ["reject_foreign", "confirmed_foreign", "reject_non_hungarian"].includes(String(podcast?.language_decision || ""));
      if (data && isForeignRejected(data)) {
        setP(null);
        setEps([]);
        setHosts([]);
        setLoading(false);
        return;
      }
      setP(data);
      setLoading(false);
      if (data) {
        const manualHostNames = (data.hosts || []) as string[];
        const [resolvedHosts, allEps] = await Promise.all([
          fetchHosts(data.id, manualHostNames),
          fetchAllEpisodes(data.id),
        ]);
        setHosts(resolvedHosts);
        setEps(allEps);

        const cleanSummary = sanitizeHungarianPublicText(data.summary);
        const cleanDesc = sanitizeHungarianPublicText(data.description);
        const canonical = typeof window !== "undefined" ? `https://podiverzum.hu/podcast/${data.slug}` : undefined;
        const hostNamesForSeo = resolvedHosts.map((h) => h.name);
        const hostPrefix = hostNamesForSeo.length
          ? `Házigazda: ${hostNamesForSeo.slice(0, 3).join(", ")}${hostNamesForSeo.length > 3 ? "…" : ""}. `
          : "";
        const baseDesc = sanitizeHungarianPublicText(data.seo_description) || cleanSummary || cleanDesc || `A(z) ${data.title} podcast epizódjai és leírása a Podiverzumon.`;
        const seoCategory = categoryLabel(data.category) || data.category;
        const isAcceptedHungarian = !isForeignRejected(data) && (data.is_hungarian === true || data.language_decision === "accept_hungarian");
        const noindex = !isAcceptedHungarian || data.rss_status === "failed" || data.rss_status === "inactive";
        const displayName = data.display_title || data.title;
        const epCount = allEps.length;
        const epCountLabel = epCount > 0 ? `${epCount} epizód · ` : "";
        const safeSeoTitle = sanitizeHungarianPublicText(data.seo_title);
        const seoTitle = safeSeoTitle
          ? (/\|\s*Podiverzum\s*$/i.test(safeSeoTitle) ? safeSeoTitle : `${safeSeoTitle} | Podiverzum`)
          : `${displayName} – ${epCountLabel}magyar podcast | Podiverzum`;
        const brandSuffix = " Hallgasd meg az összes epizódot a Podiverzumon — magyar podcast katalógus.";
        const descCore = (hostPrefix + baseDesc).trim();
        const seoDescription = snippet(`${descCore}${descCore.length < 100 ? brandSuffix : ""}`, 160);
        setSeo({
          title: seoTitle,
          description: seoDescription,
          canonical,
          noindex,
          image: ogImageUrl({ kind: "podcast", title: displayName, subtitle: seoCategory || "Podcast", image: data.image_url }),
          jsonLd: noindex ? undefined : [
            {
              "@context": "https://schema.org",
              "@type": "PodcastSeries",
              name: data.title,
              description: baseDesc,
              image: data.image_url || undefined,
              url: typeof window !== "undefined" ? window.location.href : undefined,
              webFeed: data.rss_url || undefined,
              numberOfEpisodes: allEps.length || undefined,
              author: hostNamesForSeo.length
                ? hostNamesForSeo.map((n) => ({ "@type": "Person", name: n }))
                : undefined,
            },
            breadcrumbJsonLd([
              { name: "Kezdőlap", url: typeof window !== "undefined" ? window.location.origin + "/" : "/" },
              ...(data.category ? [{ name: seoCategory || data.category, url: typeof window !== "undefined" ? `${window.location.origin}${categoryHref(data.category)}` : categoryHref(data.category) }] : []),
              { name: data.display_title || data.title, url: typeof window !== "undefined" ? window.location.href : "" },
            ]),
          ],
        });
      }
    })();
  }, [podcastSlug]);


  if (loading) return <Layout><PodcastDetailSkeleton /></Layout>;
  if (!p) return <NotFoundState title="Nincs ilyen podcast" message="A keresett podcast nem létezik, vagy már nem elérhető." />;

  const healthState = (p.shadow_rank_components as any)?.health_state;
  const isHealthy = !healthState || healthState === "healthy" || healthState === "recovered_rss_url";
  const lastFresh = p.last_fetched_at ? relativeTime(p.last_fetched_at) : null;
  const displayCategory = categoryLabel(p.category);
  const latestEpisode = eps[0] || null;
  const latestAudio = latestEpisode ? detectAudioSource(latestEpisode)?.url || latestEpisode.audio_url || null : null;
  const latestPublished = latestEpisode?.published_at ? relativeTime(latestEpisode.published_at) : null;
  const description = sanitizeHungarianPublicText(p.summary) || sanitizeHungarianPublicText(p.description);
  const externalLinks = [
    p.apple_url ? { href: p.apple_url, label: "Apple", Icon: Apple } : null,
    p.spotify_url ? { href: p.spotify_url, label: "Spotify", Icon: Music } : null,
    p.youtube_url ? { href: p.youtube_url, label: "YouTube", Icon: Youtube } : null,
    p.website_url ? { href: p.website_url, label: "Weboldal", Icon: Globe } : null,
  ].filter(Boolean) as Array<{ href: string; label: string; Icon: LucideIcon }>;
  const playLatest = () => {
    if (!latestEpisode || !latestAudio) return;
    play({
      id: latestEpisode.id,
      title: latestEpisode.display_title || latestEpisode.title,
      podcastId: p.id,
      podcastTitle: p.display_title || p.title,
      podcastSlug: p.slug || null,
      episodeSlug: latestEpisode.slug || null,
      imageUrl: latestEpisode.image_url || p.image_url || null,
      audioUrl: latestAudio,
      externalUrl: latestEpisode.episode_url || latestEpisode.audio_url || null,
    }, { resume: true });
  };

  return (
    <Layout>
      <div className="container mx-auto py-6 sm:py-10">
        <section className="relative overflow-hidden border-b border-border pb-8">
          <div className="grid gap-6 sm:grid-cols-[180px_1fr] lg:grid-cols-[210px_1fr] lg:items-start">
            <div className="mx-auto w-36 sm:mx-0 sm:w-44 lg:w-52">
              <PodcastCover title={p.display_title || p.title} src={p.image_url} size="lg" />
            </div>

            <div className="min-w-0 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                {displayCategory && (
                  <Link
                    to={categoryHref(p.category)}
                    className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary"
                  >
                    {displayCategory}
                  </Link>
                )}
                {isHealthy ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-green-500/25 bg-green-500/10 px-2.5 py-1 text-[11px] font-medium text-green-500">
                    <Activity className="h-3 w-3" /> Frissül
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-500">
                    <AlertTriangle className="h-3 w-3" /> Frissítési hiba
                  </span>
                )}
              </div>

              <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
                {p.display_title || p.title}
              </h1>

              {description && (
                <p className="mx-auto mt-4 max-w-3xl text-base leading-relaxed text-foreground/85 sm:mx-0 sm:text-lg">
                  {snippet(description, 420)}
                </p>
              )}

              <div className="mt-5 grid grid-cols-3 gap-2 text-left sm:max-w-xl">
                <PodcastStat icon={<Library className="h-4 w-4" />} label="epizód" value={eps.length.toLocaleString("hu-HU")} />
                <PodcastStat icon={<CalendarDays className="h-4 w-4" />} label="legfrissebb" value={latestPublished || "nincs adat"} />
                <PodcastStat icon={<Headphones className="h-4 w-4" />} label="állapot" value={isHealthy ? "aktív" : "ellenőrzés"} />
              </div>

              {hosts.length > 0 && (
                <div className="mt-5 max-w-2xl">
                  <div className="mb-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    <Mic className="h-3 w-3" /> {hosts.length === 1 ? "Házigazda" : "Házigazdák"}
                  </div>
                  <div className="flex flex-wrap justify-center gap-1.5 sm:justify-start">
                    {hosts.map((h, i) => {
                      const content = (
                        <>
                          <PersonAvatar name={h.name} imageUrl={h.image_url ?? null} size="sm" className="h-6 w-6" />
                          <span className="font-medium">{h.name}</span>
                        </>
                      );
                      return h.slug ? (
                        <Link
                          key={i}
                          to={`/szemelyek/${h.slug}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-1.5 py-1 pr-3 text-sm transition-colors hover:border-primary/40 hover:text-primary"
                        >
                          {content}
                        </Link>
                      ) : (
                        <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-1.5 py-1 pr-3 text-sm">
                          {content}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                {latestEpisode && latestAudio && (
                  <button
                    type="button"
                    onClick={playLatest}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    <Play className="h-4 w-4 fill-current" /> Legfrissebb epizód
                  </button>
                )}
                <PodcastFollow podcastId={p.id} />
                <SharePanel title={p.display_title || p.title} />
                {externalLinks.length > 0 && (
                  <div className="inline-flex items-center gap-1 rounded-md border border-border bg-card/70 p-1" aria-label="Külső platformok">
                    {externalLinks.map(({ href, label, Icon }) => (
                      <a
                        key={label}
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${label} megnyitása`}
                        title={label}
                        className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <Icon className="h-4 w-4" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          {lastFresh && (
            <p className="mt-4 text-center text-xs text-muted-foreground sm:pl-[204px] sm:text-left lg:pl-[234px]" title={new Date(p.last_fetched_at).toLocaleString()}>
              Utolsó frissítés: {lastFresh}
            </p>
          )}
        </section>

        {(() => {
          const epsLite = (eps as any[]).map((e) => ({ ...e, podcasts: { hosts: p.hosts || [] } }));
          const people = topEntitiesFrom(epsLite, "people", "person", 24, { excludeHosts: true, blocklist: ["Csukás István"] });
          const companies = topEntitiesFrom(epsLite, "companies", "company", 24);
          const topics = topEntitiesFrom(epsLite, "topics", "topic", 24);
          return <PodcastEntitiesCompact people={people} companies={companies} topics={topics} />;
        })()}


        <EpisodeListWithSearch eps={eps} podcast={p} />


        <SimilarPodcasts podcastId={p.id} />
      </div>
    </Layout>
  );
}

function PodcastStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/70 p-3">
      <div className="flex items-center gap-1.5 text-primary">
        {icon}
        <span className="text-sm font-semibold leading-none">{value}</span>
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
    </div>
  );
}

function EpisodeListWithSearch({ eps, podcast }: { eps: any[]; podcast: any }) {
  const [q, setQ] = useState("");
  const { play, toggle, currentEpisode, isPlaying } = useSmartPlayer();
  const podcastSlug = podcast.slug;
  const podcastTitle = podcast.display_title || podcast.title;
  const norm = (s: string) =>
    (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const needle = norm(q.trim());
  const filtered = useMemo(() => {
    if (!needle) return eps;
    return eps.filter((e) => {
      const hay = norm(
        `${e.display_title || ""} ${e.title || ""} ${pickEpisodeDescription(e, 500)}`
      );
      return hay.includes(needle);
    });
  }, [eps, needle]);

  return (
    <>
      <section className="mt-10">
      <div className="mb-4 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Epizódok</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Böngészd a műsor friss és régebbi adásait, vagy keress kifejezetten ebben a csatornában.
          </p>
        </div>
        <div className="w-full sm:w-[360px]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Keresés csak ebben a csatornában: „${podcastTitle}”…`}
              aria-label={`Keresés csak ebben a csatornában: ${podcastTitle}`}
              className="w-full pl-8 pr-8 py-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Törlés"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground text-right">
            Csak a „{podcastTitle}” epizódjai között keres.
          </p>
        </div>
      </div>

      {eps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">Ennek a podcastnak még nincsenek epizódjai.</div>
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground text-sm border border-dashed border-border rounded-lg p-6 text-center">
          Nincs találat a „{q}” keresésre ebben a műsorban.
        </div>
      ) : (
        <>
          {needle && (
            <div className="text-xs text-muted-foreground mb-2">{filtered.length} találat {eps.length} epizódból</div>
          )}
          <ul className="grid gap-3">
            {filtered.map((e, i) => {
              const fr = freshnessOf(e.published_at);
              const audioSrc = detectAudioSource(e);
              const playerAudioUrl = audioSrc?.url || e.audio_url || null;
              const thumb = e.image_url || podcast.image_url || null;
              const isCurrent = currentEpisode?.id === e.id;
              const isThisPlaying = isCurrent && isPlaying;
              const publicDescription = pickEpisodeDescription(e, 220);
              const handlePlay = () => {
                if (!playerAudioUrl) return;
                if (isCurrent) {
                  toggle();
                  return;
                }
                play({
                  id: e.id,
                  title: e.display_title || e.title,
                  podcastId: podcast.id,
                  podcastTitle: podcast.display_title || podcast.title,
                  podcastSlug: podcast.slug || null,
                  episodeSlug: e.slug || null,
                  imageUrl: e.image_url || podcast.image_url || null,
                  audioUrl: playerAudioUrl,
                  externalUrl: e.episode_url || e.audio_url || null,
                }, { resume: true });
              };
              return (
                <li key={e.id} className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/30 hover:bg-card/80 sm:p-4">
                  <div className="flex gap-3">
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted sm:h-20 sm:w-20">
                      <PodcastCover
                        title={e.display_title || e.title || podcast.display_title || podcast.title}
                        src={thumb}
                        size="sm"
                        imageSize={96}
                        imageWidths={[64, 96, 160]}
                        sizes="(max-width: 640px) 64px, 80px"
                        loading={i < 4 ? "eager" : "lazy"}
                        fetchPriority={i < 4 ? "high" : "auto"}
                        className="h-full rounded-none border-0"
                      />
                      <button
                        type="button"
                        onClick={handlePlay}
                        disabled={!playerAudioUrl}
                        className="absolute inset-0 flex items-center justify-center bg-black/25 text-white transition-colors hover:bg-black/35 disabled:pointer-events-none disabled:opacity-0"
                        aria-label={isThisPlaying ? "Szünet" : "Hallgatás"}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 backdrop-blur">
                          {isThisPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
                        </span>
                      </button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link to={`/podcast/${podcastSlug}/${e.slug}`} className="group block">
                        <div className="font-medium leading-snug group-hover:text-primary flex items-center gap-2 flex-wrap">
                          {e.display_title || e.title}
                          {fr === "new" && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-primary/40 bg-primary/15 text-[10px] font-semibold text-primary">
                              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> ÚJ
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2 items-center">
                          {e.published_at && <span title={new Date(e.published_at).toLocaleString()}>{relativeTime(e.published_at)}</span>}
                        </div>
                        {publicDescription && (
                          <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">{publicDescription}</p>
                        )}
                      </Link>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {playerAudioUrl && (
                          <button
                            type="button"
                            onClick={handlePlay}
                            className="inline-flex items-center gap-1 rounded-md bg-secondary px-2.5 py-1 text-xs text-foreground hover:bg-secondary/80"
                            aria-label={isThisPlaying ? "Szünet" : "Hallgatás"}
                          >
                            {isThisPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                            <span>{isThisPlaying ? "Szünet" : isCurrent ? "Folytatás" : "Hallgatás"}</span>
                          </button>
                        )}
                        <Link
                          to={`/podcast/${podcastSlug}/${e.slug}`}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                        >
                          Részletek <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      </section>
    </>
  );
}
