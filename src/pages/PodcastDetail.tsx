import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Apple, Music, Youtube, Globe, Activity, AlertTriangle, Mic, Search, X, Play, Pause } from "lucide-react";
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
import { slugify } from "@/lib/slug";
import { PodcastFollow } from "@/components/PodcastFollow";
import { useSmartPlayer } from "@/components/smart-player/SmartPlayerProvider";
import { detectAudioSource } from "@/lib/playerAudio";

type HostRow = { id?: string; slug?: string; name: string; image_url?: string | null };

async function fetchAllEpisodes(podcastId: string) {
  const PAGE = 1000;
  let from = 0;
  const all: any[] = [];
  for (let i = 0; i < 20; i++) {
    const { data, error } = await supabase
      .from("episodes")
      .select("id,title,display_title,slug,published_at,summary,description,audio_url,topics,people,companies,tickers,ingredients")
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
      .select("people:person_id(id, slug, name, image_url)")
      .eq("podcast_id", podcastId)
      .eq("role", "host"),
    manualNames.length
      ? supabase.from("people").select("id, slug, name, image_url").in("name", manualNames)
      : Promise.resolve({ data: [] as any[] }),
    // AI per-episode host mentions — aggregate to find recurring hosts
    supabase
      .from("person_episode_mentions")
      .select("person_id, people:person_id(id, slug, name, image_url)")
      .eq("podcast_id", podcastId)
      .eq("mention_type", "host")
      .limit(2000),
  ]);
  const aiHosts = ((aiRes.data || []) as any[])
    .map((r) => r.people)
    .filter(Boolean) as Array<{ id: string; slug: string; name: string; image_url: string | null }>;
  const manualPeople = (manualRes.data || []) as Array<{ id: string; slug: string; name: string; image_url: string | null }>;

  // Aggregate mentions: only keep people with 2+ host-episodes → clearly the host
  const mentionTally = new Map<string, { count: number; person: any }>();
  for (const row of ((mentionsRes.data || []) as any[])) {
    if (!row.person_id || !row.people) continue;
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

  useEffect(() => {
    if (!podcastSlug) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("podcasts").select("*").eq("slug", podcastSlug).maybeSingle();
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

        const cleanSummary = stripHtml(data.summary);
        const cleanDesc = stripHtml(data.description);
        const canonical = typeof window !== "undefined" ? `https://podiverzum.hu/podcast/${data.slug}` : undefined;
        const hostNamesForSeo = resolvedHosts.map((h) => h.name);
        const hostPrefix = hostNamesForSeo.length
          ? `Házigazda: ${hostNamesForSeo.slice(0, 3).join(", ")}${hostNamesForSeo.length > 3 ? "…" : ""}. `
          : "";
        const baseDesc = data.seo_description || cleanSummary || cleanDesc || `A(z) ${data.title} podcast epizódjai és leírása a Podiverzumon.`;
        setSeo({
          title: data.seo_title || `${data.title} – Podiverzum`,
          description: snippet(hostPrefix + baseDesc, 160),
          canonical,
          noindex: data.rss_status === "failed" || data.rss_status === "inactive",
          image: ogImageUrl({ kind: "podcast", title: data.display_title || data.title, subtitle: data.category || "Podcast", image: data.image_url }),
          jsonLd: [
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
              ...(data.category ? [{ name: data.category, url: typeof window !== "undefined" ? `${window.location.origin}/category/${slugify(data.category as string)}` : `/category/${data.category}` }] : []),
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

  return (
    <Layout>
      <div className="container mx-auto py-10">
        <div className="flex flex-col sm:flex-row gap-6">
          <div className="w-40 shrink-0">
            <PodcastCover title={p.display_title || p.title} src={p.image_url} size="lg" />
          </div>
          <div className="min-w-0">
            {p.category && (
              <Link to={`/category/${slugify(p.category)}`} className="text-xs uppercase tracking-wide text-accent">
                {p.category}
              </Link>
            )}
            <h1 className="text-3xl font-semibold mt-1">{p.display_title || p.title}</h1>

            <div className="flex flex-wrap gap-2 mt-2 items-center text-xs">
              {isHealthy ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-green-500/30 bg-green-500/10 text-[10px] font-medium text-green-400">
                  <Activity className="h-3 w-3" /> Frissül
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-amber-500/30 bg-amber-500/10 text-[10px] font-medium text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> Frissítési hiba
                </span>
              )}
              {lastFresh && (
                <span className="text-muted-foreground" title={new Date(p.last_fetched_at).toLocaleString()}>
                  Frissítve {lastFresh}
                </span>
              )}
            </div>


            {hosts.length > 0 && (
              <div className="mt-4 max-w-2xl">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5 inline-flex items-center gap-1">
                  <Mic className="h-3 w-3" /> {hosts.length === 1 ? "Házigazda" : "Házigazdák"}
                </div>
                <div className="flex flex-wrap gap-1.5">
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
                        to={`/person/${h.slug}`}
                        className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full bg-card border border-border hover:border-primary/40 hover:text-accent text-sm transition-colors"
                      >
                        {content}
                      </Link>
                    ) : (
                      <span key={i} className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full bg-card border border-border text-sm">
                        {content}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {p.summary && <p className="mt-3 text-foreground/90 max-w-2xl">{stripHtml(p.summary)}</p>}
            {p.description && stripHtml(p.description) !== stripHtml(p.summary) && (
              <p className="mt-2 text-sm text-muted-foreground max-w-2xl line-clamp-4">{stripHtml(p.description)}</p>
            )}
            <div className="flex flex-wrap gap-3 mt-4 items-center text-muted-foreground">
              {p.apple_url && <a href={p.apple_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent text-sm"><Apple className="h-4 w-4" /> Apple Podcasts</a>}
              {p.spotify_url && <a href={p.spotify_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent text-sm"><Music className="h-4 w-4" /> Spotify</a>}
              {p.youtube_url && <a href={p.youtube_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent text-sm"><Youtube className="h-4 w-4" /> YouTube</a>}
              {p.website_url && <a href={p.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent text-sm"><Globe className="h-4 w-4" /> Weboldal</a>}
              <PodcastFollow podcastId={p.id} />
              <SharePanel title={p.display_title || p.title} />
            </div>
          </div>
        </div>

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

function EpisodeListWithSearch({ eps, podcast }: { eps: any[]; podcast: any }) {
  const [q, setQ] = useState("");
  const { play, toggle, currentEpisode, isPlaying } = useSmartPlayer();
  const podcastSlug = podcast.slug;
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
        `${e.display_title || ""} ${e.title || ""} ${stripHtml(e.summary || "")} ${stripHtml(e.description || "")}`
      );
      return hay.includes(needle);
    });
  }, [eps, needle]);

  return (
    <>
      <div className="mt-10 mb-4 flex items-end justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold">Epizódok</h2>
        <div className="w-full sm:w-80">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Keresés csak a(z) „${podcast.display_title || podcast.title}” csatornán…`}
              aria-label={`Keresés csak a(z) ${podcast.display_title || podcast.title} csatornán`}
              className="w-full pl-8 pr-8 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
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
            Keresés csak a(z) „{podcast.display_title || podcast.title}” csatornán
          </p>
        </div>
      </div>

      {eps.length === 0 ? (
        <div className="text-muted-foreground">Ennek a podcastnak még nincsenek epizódjai.</div>
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground text-sm border border-dashed border-border rounded-lg p-6 text-center">
          Nincs találat a(z) „{q}" keresésre ebben a podcastben.
        </div>
      ) : (
        <>
          {needle && (
            <div className="text-xs text-muted-foreground mb-2">{filtered.length} találat {eps.length} epizódból</div>
          )}
          <ul className="divide-y divide-border border border-border rounded-lg bg-card">
            {filtered.map((e) => {
              const fr = freshnessOf(e.published_at);
              const audioSrc = detectAudioSource(e);
              const playerAudioUrl = audioSrc?.url || e.audio_url || null;
              const isCurrent = currentEpisode?.id === e.id;
              const isThisPlaying = isCurrent && isPlaying;
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
                <li key={e.id} className="p-4 hover:bg-secondary/50">
                  <Link to={`/podcast/${podcastSlug}/${e.slug}`} className="block">
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      {e.display_title || e.title}
                      {fr === "new" && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-primary/40 bg-primary/15 text-[10px] font-semibold text-primary">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> ÚJ
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
                  {playerAudioUrl && (
                    <button
                      type="button"
                      onClick={handlePlay}
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-2"
                      aria-label={isThisPlaying ? "Szünet" : "Hallgatás"}
                    >
                      {isThisPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      <span>{isThisPlaying ? "Szünet" : isCurrent ? "Folytatás" : "Hallgatás"}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
