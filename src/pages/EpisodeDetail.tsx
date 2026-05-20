import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Apple, Music, Youtube, ExternalLink, Play, Pause, Globe } from "lucide-react";
import { setSeo, ogImageUrl, breadcrumbJsonLd } from "@/lib/seo";
import NotFoundState from "@/components/NotFoundState";
import { stripHtml } from "@/lib/text";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { ENTITY_COLUMN, EntityKind, ENTITY_LABEL, entityHref } from "@/lib/entity";
import { EpisodeDetailSkeleton } from "@/components/Skeletons";
import { compareByScore } from "@/lib/episodeRank";
import { SimilarEpisodes } from "@/components/SimilarEpisodes";
import { SharePanel } from "@/components/SharePanel";
import { freshnessOf, relativeTime } from "@/lib/freshness";
import { slugify } from "@/lib/slug";
import { recordVisit } from "@/lib/recentlyPlayed";
import { extractKeyMoments } from "@/lib/keyMoments";
import { KeyMoments } from "@/components/KeyMoments";
import { InlineAudioPlayer } from "@/components/InlineAudioPlayer";
import { EpisodeAudioPlayer } from "@/components/smart-player/EpisodeAudioPlayer";
import { useSmartPlayer, type SmartPlayerEpisode } from "@/components/smart-player/SmartPlayerProvider";
import { detectAudioSource } from "@/lib/playerAudio";
import { getProgress } from "@/lib/playerProgress";
import { logPlayerEvent } from "@/lib/playerEvents";

const ENT_KINDS: { kind: EntityKind; label: string }[] = [
  { kind: "topic", label: "Témák" },
  { kind: "person", label: "Személyek" },
  { kind: "company", label: "Cégek" },
  { kind: "ticker", label: "Részvények" },
  { kind: "ingredient", label: "Hozzávalók" },
];

export default function EpisodeDetail() {
  const { podcastSlug, episodeSlug } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [related, setRelated] = useState<EpisodeLite[]>([]);
  const [moreFromPod, setMoreFromPod] = useState<EpisodeLite[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { playerVisible: smartPlayerVisible, play, toggle, currentEpisode, isPlaying } = useSmartPlayer();

  useEffect(() => {
    if (!podcastSlug || !episodeSlug) return;
    (async () => {
      setLoading(true);
      const { data: p } = await supabase.from("podcasts").select("*").eq("slug", podcastSlug).maybeSingle();
      if (!p) { setData(null); setLoading(false); return; }
      const { data: e } = await supabase.from("episodes").select("*").eq("podcast_id", p.id).eq("slug", episodeSlug).maybeSingle();
      setData(e ? { p, e } : { p, e: null });
      setLoading(false);
      if (!e) return;

      // Track for "Continue listening" on the homepage
      recordVisit({
        podcastSlug: p.slug,
        episodeSlug: e.slug,
        title: e.display_title || e.title,
        podcastTitle: p.display_title || p.title,
        imageUrl: e.image_url || p.image_url,
      });

      const summary = stripHtml(e.summary);
      const desc = stripHtml(e.description);
      // Unified resolver: ai_summary → clean_text → RSS summary/description
      const bestDesc = pickEpisodeDescription(e, 320);
      const metaDesc = (e.seo_description || bestDesc || `Epizód a(z) ${p.display_title || p.title} podcastből — Podiverzum.`).slice(0, 160);
      const moments = extractKeyMoments(desc || summary);

      const canonical = typeof window !== "undefined" ? `https://podiverzum.hu/podcast/${p.slug}/${e.slug}` : undefined;
      setSeo({
        title: e.seo_title || `${e.display_title || e.title} — ${p.display_title || p.title} | Podiverzum`,
        description: metaDesc,
        canonical,
        ogType: "article",
        image: ogImageUrl({
          kind: "episode",
          title: e.display_title || e.title,
          subtitle: p.display_title || p.title,
          image: e.image_url || p.image_url,
        }),
        jsonLd: [
          {
            "@context": "https://schema.org",
            "@type": "PodcastEpisode",
            name: e.title,
            description: e.seo_description || aiSum || summary || desc || undefined,
            datePublished: e.published_at || undefined,
            url: typeof window !== "undefined" ? window.location.href : undefined,
            image: e.image_url || p.image_url || undefined,
            partOfSeries: {
              "@type": "PodcastSeries",
              name: p.title,
              image: p.image_url || undefined,
              url: typeof window !== "undefined" ? `${window.location.origin}/podcast/${p.slug}` : undefined,
              webFeed: p.rss_url || undefined,
            },
            associatedMedia: e.audio_url ? { "@type": "MediaObject", contentUrl: e.audio_url } : undefined,
            hasPart: moments.length
              ? moments.map((m) => ({
                  "@type": "Clip",
                  name: m.label,
                  startOffset: m.timeSec,
                }))
              : undefined,
          },
          breadcrumbJsonLd([
            { name: "Kezdőlap", url: typeof window !== "undefined" ? window.location.origin + "/" : "/" },
            { name: p.display_title || p.title, url: typeof window !== "undefined" ? `${window.location.origin}/podcast/${p.slug}` : `/podcast/${p.slug}` },
            { name: e.display_title || e.title, url: typeof window !== "undefined" ? window.location.href : "" },
          ]),
        ],
      });

      // Related episodes by shared entity, then category, then same podcast
      const ents: { kind: EntityKind; v: string }[] = [];
      ENT_KINDS.forEach(({ kind }) => {
        const arr: string[] = e[ENTITY_COLUMN[kind]] || [];
        arr.slice(0, 4).forEach((v) => ents.push({ kind, v }));
      });

      const candidates = new Map<string, any>();
      if (ents.length) {
        for (const { kind, v } of ents.slice(0, 8)) {
          const col = ENTITY_COLUMN[kind];
          const { data: rs } = await supabase
            .from("episodes")
            .select("id,title,display_title,slug,published_at,summary,description,audio_url,topics,podcasts!inner(slug,title,display_title,image_url,category,podiverzum_rank,rank_label,rss_status)")
            .neq("id", e.id)
            .contains(col, [v])
            .order("published_at", { ascending: false, nullsFirst: false })
            .limit(8);
          (rs || []).forEach((r: any) => {
            if (r.podcasts?.rss_status === "failed" || r.podcasts?.rss_status === "inactive") return;
            candidates.set(r.id, r);
          });
          if (candidates.size >= 12) break;
        }
      }
      if (candidates.size < 6 && p.category) {
        const { data: rs } = await supabase
          .from("episodes")
          .select("id,title,display_title,slug,published_at,summary,description,audio_url,topics,podcasts!inner(slug,title,display_title,image_url,category,podiverzum_rank,rank_label,rss_status)")
          .neq("id", e.id).neq("podcast_id", p.id)
          .eq("podcasts.category", p.category)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(20);
        (rs || []).forEach((r: any) => candidates.set(r.id, r));
      }
      const rel = Array.from(candidates.values())
        .sort(compareByScore)
        .slice(0, 8);
      setRelated(rel as any);

      const { data: mp } = await supabase
        .from("episodes")
        .select("id,title,display_title,slug,published_at,summary,description,audio_url,topics,podcasts!inner(slug,title,display_title,image_url,category,podiverzum_rank,rank_label)")
        .eq("podcast_id", p.id).neq("id", e.id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(6);
      setMoreFromPod((mp || []) as any);
    })();
  }, [podcastSlug, episodeSlug]);

  const moments = useMemo(
    () => extractKeyMoments(stripHtml(data?.e?.description) || stripHtml(data?.e?.summary)),
    [data?.e?.description, data?.e?.summary],
  );

  if (loading) return <Layout><EpisodeDetailSkeleton /></Layout>;
  if (!data?.e) return <NotFoundState title="Nincs ilyen epizód" message="Ez az epizód nem létezik vagy eltávolításra került." />;
  const { p, e } = data;
  const summary = stripHtml(e.ai_summary) || stripHtml(e.summary);
  const description = stripHtml(e.description);
  const handleSeek = (sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    try {
      a.currentTime = sec;
      void a.play();
    } catch { /* noop */ }
  };

  const EntList = ({ kind, label }: { kind: EntityKind; label: string }) => {
    const items: string[] = e[ENTITY_COLUMN[kind]] || [];
    if (!items?.length) return null;
    return (
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{label}</div>
        <div className="flex flex-wrap gap-2">
          {items.map((v) => (
            <Link key={v} to={entityHref(kind, v)} className="px-2.5 py-1 rounded-full bg-secondary text-sm hover:bg-accent hover:text-accent-foreground">
              {v}
            </Link>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <div className="container mx-auto py-10 max-w-3xl">
        <Link to={`/podcast/${p.slug}`} className="text-sm text-muted-foreground hover:text-accent">← {p.display_title || p.title}</Link>
        <h1 className="text-3xl font-semibold mt-2">{e.display_title || e.title}</h1>
        <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 items-center">
          <Link to={`/podcast/${p.slug}`} className="hover:text-foreground">{p.display_title || p.title}</Link>
          {p.category && <Link to={`/category/${slugify(p.category)}`} className="hover:text-foreground">· {p.category}</Link>}
          {e.published_at && (
            <span title={new Date(e.published_at).toLocaleString()}>· {relativeTime(e.published_at)}</span>
          )}
          {e.published_at && freshnessOf(e.published_at) === "new" && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-primary/40 bg-primary/15 text-[10px] font-semibold text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> ÚJ
            </span>
          )}
          {typeof p.podiverzum_rank === "number" && p.podiverzum_rank > 0 && (
            <span
              className="text-[10px] text-muted-foreground"
              title="A Podiverzum forrásminőség-jelzése: relevancia, frissesség, konzisztencia és feed-állapot alapján."
            >
              · Forrás {Number(p.podiverzum_rank).toFixed(1)}
            </span>
          )}
        </div>

        {(() => {
          const audioSrc = detectAudioSource(e);
          const canInternalPlay = smartPlayerVisible && !!audioSrc;
          const isCurrent = currentEpisode?.id === e.id;
          const isThisPlaying = isCurrent && isPlaying;

          const handleInternalPrimary = () => {
            if (!audioSrc) return;
            if (isCurrent) {
              toggle();
              return;
            }
            const prog = getProgress(e.id);
            const canResume = !!prog && prog.currentTime > 30 && !prog.completed;
            const ep: SmartPlayerEpisode = {
              id: e.id,
              title: e.display_title || e.title,
              podcastId: p.id,
              podcastTitle: p.display_title || p.title,
              podcastSlug: p.slug || null,
              episodeSlug: e.slug || null,
              imageUrl: e.image_url || p.image_url || null,
              audioUrl: audioSrc.url,
              externalUrl: e.episode_url || e.audio_url || null,
            };
            play(ep, { resume: canResume });
          };

          const trackExternal = (platform: string, url: string) => {
            logPlayerEvent({
              eventType: "external_open",
              episodeId: e.id,
              podcastId: p.id,
              meta: { platform, url },
            });
          };

          const externalFallbackHref = e.audio_url || e.episode_url || null;
          const externalFallbackLabel = e.audio_url
            ? "Megnyitás külső lejátszóban"
            : "Megnyitás az eredeti oldalon";

          return (
            <>
              {/* Primary CTA */}
              <div className="mt-5">
                {canInternalPlay ? (
                  <button
                    onClick={handleInternalPrimary}
                    aria-label={isThisPlaying ? "Szünet" : "Hallgatás"}
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-primary text-primary-foreground font-semibold shadow-[0_6px_22px_-8px_hsl(var(--brand-red)/0.55)] hover:bg-primary/90 transition-colors"
                  >
                    {isThisPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                    <span>{isThisPlaying ? "Szünet" : isCurrent ? "Folytatás" : "Hallgatás"}</span>
                  </button>
                ) : externalFallbackHref ? (
                  <a
                    href={externalFallbackHref}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => trackExternal("original_page", externalFallbackHref)}
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-primary text-primary-foreground font-semibold shadow-[0_6px_22px_-8px_hsl(var(--brand-red)/0.55)] hover:bg-primary/90 transition-colors"
                  >
                    <ExternalLink className="h-5 w-5" />
                    <span>{externalFallbackLabel}</span>
                  </a>
                ) : null}
              </div>

              {/* Secondary platform row */}
              {(p.apple_url || p.spotify_url || p.youtube_url) && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1 hidden sm:inline">
                    Más platformon
                  </span>
                  {p.apple_url && (
                    <a
                      href={p.apple_url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => trackExternal("apple", p.apple_url)}
                      aria-label="Megnyitás Apple Podcasts-ban"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card/60 text-xs text-foreground/80 hover:bg-secondary hover:text-foreground transition-colors"
                    >
                      <Apple className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Apple</span>
                    </a>
                  )}
                  {p.spotify_url && (
                    <a
                      href={p.spotify_url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => trackExternal("spotify", p.spotify_url)}
                      aria-label="Megnyitás Spotify-on"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card/60 text-xs text-foreground/80 hover:bg-secondary hover:text-foreground transition-colors"
                    >
                      <Music className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Spotify</span>
                    </a>
                  )}
                  {p.youtube_url && (
                    <a
                      href={p.youtube_url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => trackExternal("youtube", p.youtube_url)}
                      aria-label="Megnyitás YouTube-on"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card/60 text-xs text-foreground/80 hover:bg-secondary hover:text-foreground transition-colors"
                    >
                      <Youtube className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">YouTube</span>
                    </a>
                  )}
                  {canInternalPlay && e.episode_url && (
                    <a
                      href={e.episode_url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => trackExternal("original_page", e.episode_url)}
                      aria-label="Eredeti oldal megnyitása"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card/60 text-xs text-foreground/80 hover:bg-secondary hover:text-foreground transition-colors"
                    >
                      <Globe className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Eredeti</span>
                    </a>
                  )}
                  <div className="ml-auto">
                    <SharePanel title={`${e.display_title || e.title} — ${p.display_title || p.title}`} />
                  </div>
                </div>
              )}
              {!(p.apple_url || p.spotify_url || p.youtube_url) && (
                <div className="mt-3">
                  <SharePanel title={`${e.display_title || e.title} — ${p.display_title || p.title}`} />
                </div>
              )}

              {/* Smart Player card (or legacy inline fallback) */}
              {smartPlayerVisible ? (
                <EpisodeAudioPlayer episode={e} podcast={p} />
              ) : (
                e.audio_url && (
                  <InlineAudioPlayer ref={audioRef} src={e.audio_url} title={e.display_title || e.title} />
                )
              )}
            </>
          );
        })()}

        {summary && (
          <div className="mt-6 p-4 rounded-lg border border-border bg-card">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Összefoglaló</div>
            <p className="whitespace-pre-wrap">{summary}</p>
            <p className="text-[10px] text-muted-foreground mt-2">Indexelt epizód-metaadatból generálva.</p>
          </div>
        )}

        {description && description !== summary && (
          <div className="mt-6 text-sm text-foreground/90 whitespace-pre-wrap">{description}</div>
        )}

        {moments.length > 0 && (
          <KeyMoments moments={moments} audioUrl={e.audio_url} onSeek={e.audio_url ? handleSeek : undefined} />
        )}

        <div className="grid gap-4 mt-8">
          {ENT_KINDS.map(({ kind, label }) => <EntList key={kind} kind={kind} label={label} />)}
        </div>

        <SimilarEpisodes episodeId={e.id} />

        {moreFromPod.length > 0 && (
          <section className="mt-10">
            <h2 className="font-semibold mb-3">További epizódok — {p.display_title || p.title}</h2>
            <EpisodeList items={moreFromPod} showEntities />
          </section>
        )}

        <p className="text-xs text-muted-foreground mt-10">
          Nyilvános RSS-forrásból indexelve{p.rss_url ? ` (${(() => { try { return new URL(p.rss_url).hostname; } catch { return "forrás"; } })()})` : ""}.
          Frissesség, forrásminőség és relevancia alapján rangsorolva.
        </p>
      </div>
    </Layout>
  );
}