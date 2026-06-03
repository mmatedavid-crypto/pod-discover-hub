import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Apple, Brain, Music, Youtube, ExternalLink, Play, Pause, Globe, CalendarDays, ArrowLeft, Sparkles } from "lucide-react";
import { setSeo, ogImageUrl, breadcrumbJsonLd } from "@/lib/seo";
import NotFoundState from "@/components/NotFoundState";
import { stripHtml } from "@/lib/text";
import { pickEpisodeDescription } from "@/lib/episodeText";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { ENTITY_COLUMN, EntityKind, ENTITY_LABEL, entityHref } from "@/lib/entity";
import { EpisodeDetailSkeleton } from "@/components/Skeletons";
import { SimilarEpisodes } from "@/components/SimilarEpisodes";
import { SharePanel } from "@/components/SharePanel";
import { EpisodeMarks } from "@/components/EpisodeMarks";
import { freshnessOf, relativeTime } from "@/lib/freshness";
import { categoryHref, categoryLabel } from "@/lib/categoryLabels";
import { recordVisit } from "@/lib/recentlyPlayed";
import { extractKeyMoments } from "@/lib/keyMoments";
import { KeyMoments } from "@/components/KeyMoments";
import { InlineAudioPlayer } from "@/components/InlineAudioPlayer";
import { EpisodeAudioPlayer } from "@/components/smart-player/EpisodeAudioPlayer";
import { useSmartPlayer, type SmartPlayerEpisode } from "@/components/smart-player/SmartPlayerProvider";
import { detectAudioSource } from "@/lib/playerAudio";
import { getProgress } from "@/lib/playerProgress";
import { logPlayerEvent } from "@/lib/playerEvents";
import { RelatedEpisodes } from "@/components/smart-player/RelatedEpisodes";
import { getEpisodeUnderstanding } from "@/lib/episodeUnderstanding";
import { PodcastCover } from "@/components/PodcastCover";

const ENT_KINDS: { kind: EntityKind; label: string }[] = [
  { kind: "topic", label: "Témák" },
  { kind: "person", label: "Személyek" },
  { kind: "company", label: "Szervezetek" },
  { kind: "ticker", label: "Részvények" },
  { kind: "ingredient", label: "Hozzávalók" },
];


export default function EpisodeDetail() {
  const { podcastSlug, episodeSlug } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [moreFromPod, setMoreFromPod] = useState<EpisodeLite[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { playerVisible: smartPlayerVisible, play, toggle, currentEpisode, isPlaying, seekTo } = useSmartPlayer();
  const location = useLocation();
  const deepLinkAppliedRef = useRef<string | null>(null);

  // ?t=<sec> deep-link → autoplay at that position once data is loaded.
  useEffect(() => {
    if (!data?.e || !data?.p) return;
    const params = new URLSearchParams(location.search);
    const tRaw = params.get("t");
    if (!tRaw) return;
    const t = Math.max(0, Math.floor(Number(tRaw)));
    if (!isFinite(t) || t <= 0) return;
    const key = `${data.e.id}:${t}`;
    if (deepLinkAppliedRef.current === key) return;
    deepLinkAppliedRef.current = key;
    const audioSrc = detectAudioSource(data.e);
    const playerAudioUrl = audioSrc?.url || data.e.audio_url || null;
    if (!playerAudioUrl) return;
    if (currentEpisode?.id === data.e.id) {
      seekTo(t);
      return;
    }
    const ep: SmartPlayerEpisode = {
      id: data.e.id,
      title: data.e.display_title || data.e.title,
      podcastId: data.p.id,
      podcastTitle: data.p.display_title || data.p.title,
      podcastSlug: data.p.slug || null,
      episodeSlug: data.e.slug || null,
      imageUrl: data.e.image_url || data.p.image_url || null,
      audioUrl: playerAudioUrl,
      externalUrl: data.e.episode_url || data.e.audio_url || null,
    };
    play(ep, { startAt: t });
  }, [data, location.search, currentEpisode, play, seekTo]);

  useEffect(() => {
    if (!podcastSlug || !episodeSlug) return;
    (async () => {
      setLoading(true);
      const { data: p } = await supabase.from("podcasts").select("*").eq("slug", podcastSlug).maybeSingle();
      if (!p) { setData(null); setLoading(false); return; }
      const isForeignRejected = ["reject_foreign", "confirmed_foreign", "reject_non_hungarian"].includes(String(p.language_decision || ""));
      if (isForeignRejected) {
        setData(null);
        setLoading(false);
        return;
      }
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
      const safeSeoDescription = sanitizeHungarianPublicText(e.seo_description);
      const safeSeoTitle = sanitizeHungarianPublicText(e.seo_title);
      const metaDesc = (safeSeoDescription || bestDesc || `Epizód a(z) ${p.display_title || p.title} podcastből — Podiverzum.`).slice(0, 160);
      const moments = extractKeyMoments(desc || summary);

      const canonical = typeof window !== "undefined" ? `https://podiverzum.hu/podcast/${p.slug}/${e.slug}` : undefined;
      const isAcceptedHungarian = !isForeignRejected && (p.is_hungarian === true || p.language_decision === "accept_hungarian");
      setSeo({
        title: safeSeoTitle || `${e.display_title || e.title} — ${p.display_title || p.title} | Podiverzum`,
        description: metaDesc,
        canonical,
        noindex: !isAcceptedHungarian,
        ogType: "article",
        image: ogImageUrl({
          kind: "episode",
          title: e.display_title || e.title,
          subtitle: p.display_title || p.title,
          image: e.image_url || p.image_url,
        }),
        jsonLd: !isAcceptedHungarian ? undefined : [
          {
            "@context": "https://schema.org",
            "@type": "PodcastEpisode",
            name: e.title,
            description: safeSeoDescription || bestDesc || undefined,
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
  const summary = pickEpisodeDescription(e, 420) || stripHtml(e.summary);
  const description = stripHtml(e.description);
  const understanding = getEpisodeUnderstanding(e);
  const handleSeek = (sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    try {
      a.currentTime = sec;
      void a.play();
    } catch { /* noop */ }
  };
  const displayCategory = categoryLabel(p.category);
  const hasEntities = ENT_KINDS.some(({ kind }) => ((e[ENTITY_COLUMN[kind]] || []) as string[]).length > 0);

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
      <div className="container mx-auto py-6 sm:py-10 max-w-5xl">
        <section className="border-b border-border pb-8">
          <Link
            to={`/podcast/${p.slug}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            {p.display_title || p.title}
          </Link>

          <div className="mt-5 grid gap-5 sm:grid-cols-[132px_1fr] lg:grid-cols-[160px_1fr]">
            <div className="mx-auto w-32 sm:mx-0 sm:w-40">
              <PodcastCover title={p.display_title || p.title} src={e.image_url || p.image_url} size="lg" />
            </div>

            <div className="min-w-0 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <Link
                  to={`/podcast/${p.slug}`}
                  className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground hover:border-primary/40 hover:text-primary"
                >
                  {p.display_title || p.title}
                </Link>
                {displayCategory && (
                  <Link
                    to={categoryHref(p.category)}
                    className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary"
                  >
                    {displayCategory}
                  </Link>
                )}
                {e.published_at && freshnessOf(e.published_at) === "new" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-[10px] font-semibold text-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> ÚJ
                  </span>
                )}
              </div>

              <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">
                {e.display_title || e.title}
              </h1>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground sm:justify-start">
                {e.published_at && (
                  <span className="inline-flex items-center gap-1.5" title={new Date(e.published_at).toLocaleString()}>
                    <CalendarDays className="h-4 w-4" />
                    {relativeTime(e.published_at)}
                  </span>
                )}
                {understanding?.headline && (
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Podiverzum ajánlóval
                  </span>
                )}
              </div>

              {summary && (
                <p className="mx-auto mt-4 max-w-3xl text-base leading-relaxed text-foreground/85 sm:mx-0 sm:text-lg">
                  {summary}
                </p>
              )}
            </div>
          </div>
        </section>

        {(() => {
          const audioSrc = detectAudioSource(e);
          const playerAudioUrl = audioSrc?.url || e.audio_url || null;
          const canInternalPlay = !!playerAudioUrl;
          const isCurrent = currentEpisode?.id === e.id;
          const isThisPlaying = isCurrent && isPlaying;

          const handleInternalPrimary = () => {
            if (!playerAudioUrl) return;
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
              audioUrl: playerAudioUrl,
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
              <div className="mt-6 flex flex-wrap items-center gap-2">
                {canInternalPlay ? (
                  <button
                    onClick={handleInternalPrimary}
                    aria-label={isThisPlaying ? "Szünet" : "Hallgatás"}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 font-semibold text-primary-foreground shadow-[0_6px_22px_-8px_hsl(var(--brand-red)/0.55)] transition-colors hover:bg-primary/90"
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
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 font-semibold text-primary-foreground shadow-[0_6px_22px_-8px_hsl(var(--brand-red)/0.55)] transition-colors hover:bg-primary/90"
                  >
                    <ExternalLink className="h-5 w-5" />
                    <span>{externalFallbackLabel}</span>
                  </a>
                ) : null}
                <EpisodeMarks episodeId={e.id} />
                <SharePanel title={`${e.display_title || e.title} — ${p.display_title || p.title}`} />
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
                </div>
              )}
              {!(p.apple_url || p.spotify_url || p.youtube_url) && (
                null
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

        {understanding && (
          <section className="mt-6 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Brain className="h-4 w-4 text-primary" />
              A Podiverzum szerint
            </div>
            <p className="text-base font-medium text-foreground">{understanding.headline}</p>
            {understanding.chips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {understanding.chips.map((chip) => (
                  <Link
                    key={`${chip.kind}-${chip.label}`}
                    to={entityHref(chip.kind, chip.label)}
                    className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-foreground/85 transition-colors hover:border-primary/40 hover:text-primary"
                    aria-label={`${ENTITY_LABEL[chip.kind]}: ${chip.label}`}
                  >
                    {chip.label}
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {description && description !== summary && (
          <section className="mt-6 rounded-lg border border-border bg-card p-4">
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Leírás</div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{description}</div>
          </section>
        )}

        {moments.length > 0 && (
          <KeyMoments moments={moments} audioUrl={e.audio_url} onSeek={e.audio_url ? handleSeek : undefined} />
        )}

        {hasEntities && (
          <div className="grid gap-4 mt-8 rounded-lg border border-border bg-card p-4">
            {ENT_KINDS.map(({ kind, label }) => <EntList key={kind} kind={kind} label={label} />)}
          </div>
        )}

        <RelatedEpisodes episodeIdOverride={e.id} podcastIdOverride={p.id} variant="compact" />

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
