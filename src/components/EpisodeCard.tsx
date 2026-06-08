import { lazy, Suspense, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { PodcastCover } from "./PodcastCover";
import { Brain, Info, Play } from "lucide-react";
import { highlightParts, snippet } from "@/lib/text";
import { freshnessOf, relativeTime } from "@/lib/freshness";
import { entityHref } from "@/lib/entity";
import { useSmartPlayer } from "./smart-player/SmartPlayerProvider";
import { detectAudioSource } from "@/lib/playerAudio";
import { getEpisodeUnderstanding } from "@/lib/episodeUnderstanding";
import { categoryLabel } from "@/lib/categoryLabels";
import { pickEpisodeDescription } from "@/lib/episodeText";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";
import { imageSrcSet, optimizedImageUrl } from "@/lib/image";

const EpisodeMarks = lazy(() => import("./EpisodeMarks").then((m) => ({ default: m.EpisodeMarks })));

export type EpisodeLite = {
  id: string;
  podcast_id?: string | null;
  title: string;
  display_title?: string | null;
  slug: string;
  ai_summary?: string | null;
  summary?: string | null;
  description?: string | null;
  image_url?: string | null;
  published_at?: string | null;
  audio_url?: string | null;
  // episode_rank intentionally removed (Formula C v3 cleanup; legacy frozen field)
  topics?: string[] | null;
  people?: string[] | null;
  mentioned?: string[] | null;
  companies?: string[] | null;
  organizations?: string[] | null;
  tickers?: string[] | null;
  ingredients?: string[] | null;
  /** Optional UI hint from search relevance scoring. */
  matchBadge?: string | null;
  /** Optional one-line AI reason why this matched the query. */
  why_matched?: string | null;
  /** Optional timestamped chunk hit from semantic search. */
  chunk_match?: {
    source?: string | null;
    similarity?: number | null;
    chunk_idx?: number | null;
    content_snippet?: string | null;
    timestamp_start_seconds?: number | null;
    timestamp_end_seconds?: number | null;
    segment_start_idx?: number | null;
    segment_end_idx?: number | null;
    source_transcript_model?: string | null;
    chunking_method?: string | null;
  } | null;
  /** Optional one-line editorial reason for homepage rails. */
  homepageReason?: string | null;
  podcasts: {
    slug: string;
    title: string;
    display_title?: string | null;
    image_url?: string | null;
    category?: string | null;
    podiverzum_rank?: number | null;
  };
};

function HL({ text, terms }: { text: string; terms?: string[] }) {
  if (!terms || !terms.length) return <>{text}</>;
  const parts = highlightParts(text, terms);
  return (
    <>
      {parts.map((p, i) => p.hit
        ? <mark key={i} className="bg-primary/25 text-foreground rounded px-0.5">{p.s}</mark>
        : <span key={i}>{p.s}</span>)}
    </>
  );
}

function railBackdropStyle(title: string): CSSProperties {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return {
    background:
      `radial-gradient(circle at 20% 20%, hsl(${hue} 55% 42% / 0.38), transparent 42%), ` +
      `radial-gradient(circle at 82% 18%, hsl(${(hue + 72) % 360} 50% 48% / 0.28), transparent 38%), ` +
      `linear-gradient(135deg, hsl(${hue} 28% 16%), hsl(${(hue + 36) % 360} 26% 10%))`,
  };
}

function EpisodeMarksSlot({ episodeId }: { episodeId: string }) {
  return (
    <div className="ml-auto min-h-8 min-w-[76px]">
      <Suspense fallback={<span aria-hidden className="block h-8 w-[76px]" />}>
        <EpisodeMarks episodeId={episodeId} compact />
      </Suspense>
    </div>
  );
}

function safeEpisodeCardPublicText(value: unknown, minLength = 2): string {
  const clean = sanitizeHungarianPublicText(String(value || ""));
  return clean.length >= minLength ? clean : "";
}

function formatSeekTime(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function EpisodeCard({
  e, showTopics = false, terms, showEntities = false, imagePriority = false,
}: { e: EpisodeLite; showTopics?: boolean; terms?: string[]; showEntities?: boolean; imagePriority?: boolean }) {
  const p = e.podcasts;
  const epTitle = e.display_title || e.title;
  const podTitle = p.display_title || p.title;
  const desc = snippet(pickEpisodeDescription(e, 260), 220, terms);
  const understanding = getEpisodeUnderstanding(e);
  const categoryName = categoryLabel(p.category);
  const coverImage = e.image_url || p.image_url || null;
  const coverTitle = e.image_url ? epTitle : podTitle;
  const { play } = useSmartPlayer();
  const playable = detectAudioSource({ audio_url: e.audio_url });
  const playerAudioUrl = playable?.url || e.audio_url || null;
  const safeWhyMatched = safeEpisodeCardPublicText(e.why_matched, 12);
  const safeHomepageReason = safeEpisodeCardPublicText(e.homepageReason);
  const safeChunkSnippet = safeEpisodeCardPublicText(e.chunk_match?.content_snippet, 24);
  const chunkStartRaw = Number(e.chunk_match?.timestamp_start_seconds);
  const chunkStart = Number.isFinite(chunkStartRaw) && chunkStartRaw >= 0 ? Math.floor(chunkStartRaw) : null;
  const handlePlay = (ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!playerAudioUrl) return;
    play({
      id: e.id,
      title: epTitle,
      podcastId: undefined,
      podcastTitle: podTitle,
      podcastSlug: p.slug,
      episodeSlug: e.slug,
      imageUrl: coverImage,
      audioUrl: playerAudioUrl,
      externalUrl: e.audio_url || null,
    }, { resume: true });
  };
  const handlePlayFromMatch = (ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!playerAudioUrl || chunkStart == null) return;
    play({
      id: e.id,
      title: epTitle,
      podcastId: undefined,
      podcastTitle: podTitle,
      podcastSlug: p.slug,
      episodeSlug: e.slug,
      imageUrl: coverImage,
      audioUrl: playerAudioUrl,
      externalUrl: e.audio_url || null,
    }, { startAt: chunkStart });
  };
  const allEnts = showEntities
    ? [
        ...(e.topics || []).map((v) => ({ kind: "topic" as const, v })),
        ...(e.people || []).map((v) => ({ kind: "person" as const, v })),
        ...(e.companies || []).map((v) => ({ kind: "company" as const, v })),
        ...(e.tickers || []).map((v) => ({ kind: "ticker" as const, v })),
        ...(e.ingredients || []).map((v) => ({ kind: "ingredient" as const, v })),
      ].slice(0, 6)
    : [];
  return (
    <article className="group flex gap-3 sm:gap-4 p-4 sm:p-5 hover:bg-secondary/40 transition-colors">
      <Link to={`/podcast/${p.slug}`} className="shrink-0 w-16 sm:w-20">
        <div className="overflow-hidden rounded-md ring-1 ring-border/70 shadow-sm">
          <PodcastCover
            title={coverTitle}
            src={coverImage}
            size="sm"
            imageSize={80}
            imageWidths={[64, 96, 128]}
            sizes="(max-width: 640px) 64px, 80px"
            loading={imagePriority ? "eager" : "lazy"}
            fetchPriority={imagePriority ? "high" : "low"}
          />
        </div>
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/podcast/${p.slug}/${e.slug}`} className="font-semibold leading-snug line-clamp-2 group-hover:underline tracking-tight">
          <HL text={epTitle} terms={terms} />
        </Link>
        <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-2 gap-y-1 items-center">
          <Link to={`/podcast/${p.slug}`} className="hover:text-foreground font-medium">{podTitle}</Link>
          {categoryName && <span className="opacity-60">·</span>}
          {categoryName && <span>{categoryName}</span>}
          {e.published_at && (() => {
            const fr = freshnessOf(e.published_at);
            return (
              <>
                <span className="opacity-60">·</span>
                <span title={new Date(e.published_at).toLocaleString()}>{relativeTime(e.published_at)}</span>
                {fr === "new" && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-primary/40 bg-primary/15 text-[10px] font-semibold text-primary">
                    <span className="relative inline-flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                    </span>
                    ÚJ
                  </span>
                )}
              </>
            );
          })()}
          {e.matchBadge && (
            <span className="px-1.5 py-0.5 rounded-md border border-border bg-secondary text-[10px] font-medium text-foreground/80">{e.matchBadge}</span>
          )}
          {safeHomepageReason && (
            <span className="px-1.5 py-0.5 rounded-md border border-primary/35 bg-primary/10 text-[10px] font-medium text-primary">{safeHomepageReason}</span>
          )}
          {chunkStart != null && (
            <span className="px-1.5 py-0.5 rounded-md border border-primary/35 bg-primary/10 text-[10px] font-medium text-primary">
              Találat {formatSeekTime(chunkStart)}
            </span>
          )}
          {understanding && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-primary/30 bg-primary/10 text-[10px] font-medium text-foreground/80"
              title="RSS leírásból és feldolgozott epizód-metaadatból számolt tartalmi jelzés."
            >
              <Brain className="h-3 w-3 text-primary" />
              Podiverzum szerint
            </span>
          )}
        </div>
        {safeWhyMatched && (
          <p className="text-[12px] mt-2 px-2.5 py-1.5 rounded-md border border-primary/40 bg-primary/10 text-foreground leading-snug">
            <span className="font-semibold text-primary mr-1">Miért releváns:</span>
            {safeWhyMatched}
          </p>
        )}
        {!safeWhyMatched && understanding && (
          <p className="text-[12px] mt-2 px-2.5 py-1.5 rounded-md border border-primary/30 bg-primary/5 text-foreground/85 leading-snug line-clamp-2">
            <span className="font-semibold text-primary mr-1">A lényeg:</span>
            {understanding.headline}
          </p>
        )}
        {safeChunkSnippet && (
          <p className="text-[12px] mt-2 px-2.5 py-1.5 rounded-md border border-primary/30 bg-primary/5 text-foreground/85 leading-snug line-clamp-2">
            <span className="font-semibold text-primary mr-1">Transcript találat:</span>
            <HL text={safeChunkSnippet} terms={terms} />
          </p>
        )}
        {desc && (
          <p className="text-sm text-muted-foreground line-clamp-3 sm:line-clamp-2 mt-2 leading-relaxed">
            <HL text={desc} terms={terms} />
          </p>
        )}
        {(showTopics && e.topics && e.topics.length > 0) && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {e.topics.slice(0, 5).map((t) => (
              <Link key={t} to={entityHref("topic", t)} className="px-2 py-0.5 rounded-full border border-border bg-card text-[11px] hover:border-primary/50 hover:bg-primary/10 hover:text-foreground transition-colors">
                {t}
              </Link>
            ))}
          </div>
        )}
        {showEntities && allEnts.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {allEnts.map(({ kind, v }) => {
              return (
                <Link key={`${kind}-${v}`} to={entityHref(kind as any, v)} className="px-2 py-0.5 rounded-full border border-border bg-card text-[11px] hover:border-primary/50 hover:bg-primary/10 hover:text-foreground transition-colors">
                  {v}
                </Link>
              );
            })}
          </div>
        )}
        <div className="flex gap-2 mt-2.5 text-xs">
          {/* Mobile: compact icon buttons */}
          <Link
            to={`/podcast/${p.slug}/${e.slug}`}
            aria-label="Részletek"
            className="sm:hidden inline-flex items-center justify-center h-8 w-8 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            <Info className="h-3.5 w-3.5" />
          </Link>
          {e.audio_url && (
            <button
              type="button"
              onClick={handlePlay}
              aria-label="Lejátszás"
              className="sm:hidden inline-flex items-center justify-center h-8 w-8 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {playerAudioUrl && chunkStart != null && (
            <button
              type="button"
              onClick={handlePlayFromMatch}
              aria-label={`Lejátszás innen: ${formatSeekTime(chunkStart)}`}
              title={`Lejátszás innen: ${formatSeekTime(chunkStart)}`}
              className="sm:hidden inline-flex items-center justify-center h-8 w-8 rounded-md border border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {/* Tablet/desktop: text links */}
          <Link to={`/podcast/${p.slug}/${e.slug}`} className="hidden sm:inline text-muted-foreground hover:text-foreground">Részletek</Link>
          {e.audio_url && (
            <button
              type="button"
              onClick={handlePlay}
              className="hidden sm:inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <Play className="h-3 w-3" /> Lejátszás
            </button>
          )}
          {playerAudioUrl && chunkStart != null && (
            <button
              type="button"
              onClick={handlePlayFromMatch}
              className="hidden sm:inline-flex items-center gap-1 text-primary hover:text-primary/80 font-medium"
            >
              <Play className="h-3 w-3" /> Lejátszás innen
            </button>
          )}
          <EpisodeMarksSlot episodeId={e.id} />
        </div>
      </div>
    </article>
  );
}

function EpisodeRailCard({
  e, showTopics = false, terms, showEntities = false, imagePriority = false,
}: { e: EpisodeLite; showTopics?: boolean; terms?: string[]; showEntities?: boolean; imagePriority?: boolean }) {
  const p = e.podcasts;
  const epTitle = e.display_title || e.title;
  const podTitle = p.display_title || p.title;
  const desc = snippet(pickEpisodeDescription(e, 210), 170, terms);
  const understanding = getEpisodeUnderstanding(e);
  const categoryName = categoryLabel(p.category);
  const coverImage = e.image_url || p.image_url || null;
  const coverTitle = e.image_url ? epTitle : podTitle;
  const { play } = useSmartPlayer();
  const playable = detectAudioSource({ audio_url: e.audio_url });
  const playerAudioUrl = playable?.url || e.audio_url || null;
  const safeHomepageReason = safeEpisodeCardPublicText(e.homepageReason);
  const handlePlay = (ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!playerAudioUrl) return;
    play({
      id: e.id,
      title: epTitle,
      podcastId: e.podcast_id || undefined,
      podcastTitle: podTitle,
      podcastSlug: p.slug,
      episodeSlug: e.slug,
      imageUrl: coverImage,
      audioUrl: playerAudioUrl,
      externalUrl: e.audio_url || null,
    }, { resume: true });
  };
  const allEnts = showEntities
    ? [
        ...(e.topics || []).map((v) => ({ kind: "topic" as const, v })),
        ...(e.people || []).map((v) => ({ kind: "person" as const, v })),
        ...(e.companies || []).map((v) => ({ kind: "company" as const, v })),
      ].slice(0, 4)
    : [];
  const fr = e.published_at ? freshnessOf(e.published_at) : null;

  return (
    <article className="group h-full overflow-hidden rounded-lg border border-border/70 bg-card/80 shadow-sm transition-all hover:border-primary/50 hover:bg-card">
      <Link to={`/podcast/${p.slug}/${e.slug}`} className="block">
        <div className="relative aspect-[16/10] overflow-hidden bg-secondary">
          <div className="absolute inset-0 opacity-90" style={railBackdropStyle(podTitle)} />
          {coverImage && (
            <img
              src={optimizedImageUrl(coverImage, { width: 480, height: 300 }) || coverImage}
              srcSet={imageSrcSet(coverImage, [320, 480, 640])}
              sizes="(max-width: 640px) 80vw, 340px"
              alt={coverTitle}
              loading={imagePriority ? "eager" : "lazy"}
              fetchPriority={imagePriority ? "high" : "low"}
              decoding="async"
              width={480}
              height={300}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/55 to-transparent" />
          {playerAudioUrl && (
            <button
              type="button"
              onClick={handlePlay}
              aria-label="Lejátszás"
              className="absolute bottom-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-brand transition-transform group-hover:scale-105"
            >
              <Play className="h-4 w-4 fill-current" />
            </button>
          )}
          <div className="absolute bottom-3 left-3 right-16">
            <div className="text-[11px] font-medium text-foreground/90 line-clamp-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">{podTitle}</div>
            {fr === "new" && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> ÚJ
              </div>
            )}
          </div>
        </div>
      </Link>
      <div className="flex min-h-[210px] flex-col p-3 sm:p-4">
        <Link to={`/podcast/${p.slug}/${e.slug}`} className="font-semibold leading-snug line-clamp-2 group-hover:underline">
          <HL text={epTitle} terms={terms} />
        </Link>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {categoryName && <span>{categoryName}</span>}
          {e.published_at && (
            <>
              {categoryName && <span className="opacity-60">·</span>}
              <span title={new Date(e.published_at).toLocaleString()}>{relativeTime(e.published_at)}</span>
            </>
          )}
          {understanding && (
            <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80">
              <Brain className="h-3 w-3 text-primary" />
              Podiverzum szerint
            </span>
          )}
          {safeHomepageReason && (
            <span className="rounded-md border border-primary/35 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {safeHomepageReason}
            </span>
          )}
        </div>
        {understanding && (
          <p className="mt-2 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-1.5 text-[12px] leading-snug text-foreground/85 line-clamp-2">
            <span className="font-semibold text-primary mr-1">A lényeg:</span>
            {understanding.headline}
          </p>
        )}
        {!understanding && desc && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground line-clamp-3">
            <HL text={desc} terms={terms} />
          </p>
        )}
        {(showTopics && e.topics && e.topics.length > 0) && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {e.topics.slice(0, 3).map((t) => (
              <Link key={t} to={entityHref("topic", t)} className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground">
                {t}
              </Link>
            ))}
          </div>
        )}
        {showEntities && allEnts.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {allEnts.map(({ kind, v }) => {
              return (
                <Link key={`${kind}-${v}`} to={entityHref(kind as any, v)} className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground">
                  {v}
                </Link>
              );
            })}
          </div>
        )}
        <div className="mt-auto flex items-center gap-2 pt-3 text-xs">
          <Link to={`/podcast/${p.slug}/${e.slug}`} className="text-muted-foreground hover:text-foreground">Részletek</Link>
          <EpisodeMarksSlot episodeId={e.id} />
        </div>
      </div>
    </article>
  );
}

export function EpisodeList({
  items, showTopics = false, empty = "Még nincsenek epizódok.", terms, showEntities = false, scrollOnMobile = false, scrollAlways = false,
}: { items: EpisodeLite[]; showTopics?: boolean; empty?: string; terms?: string[]; showEntities?: boolean; scrollOnMobile?: boolean; scrollAlways?: boolean }) {
  if (!items.length) return <div className="text-muted-foreground text-sm p-4">{empty}</div>;

  if (scrollAlways) {
    return (
      <div className="-mx-4 sm:-mx-2 relative">
        <div
          className="flex gap-3 sm:gap-4 overflow-x-auto snap-x snap-mandatory pl-4 sm:pl-2 pr-8 pb-3 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ scrollPaddingLeft: "1rem", WebkitOverflowScrolling: "touch" }}
        >
          {items.map((e, i) => (
            <div
              key={e.id}
              className="snap-start shrink-0 w-[78vw] max-w-[340px] sm:w-[340px]"
            >
              <EpisodeRailCard e={e} showTopics={showTopics} terms={terms} showEntities={showEntities} imagePriority={i === 0} />
            </div>
          ))}
          <div aria-hidden className="shrink-0 w-2" />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent"
        />
      </div>
    );
  }

  const desktop = (
    <ul className={`${scrollOnMobile ? "hidden sm:block " : ""}divide-y divide-border/70 sm:border sm:border-border/70 sm:rounded-xl sm:bg-card/60 sm:surface overflow-hidden`}>
      {items.map((e, i) => (
        <li key={e.id} className="transition-colors">
          <EpisodeCard e={e} showTopics={showTopics} terms={terms} showEntities={showEntities} imagePriority={i === 0} />
        </li>
      ))}
    </ul>
  );
  if (!scrollOnMobile) return desktop;
  return (
    <>
      <div className="sm:hidden -mx-4 relative">
        <div
          className="flex gap-3 overflow-x-auto snap-x snap-mandatory pl-4 pr-8 pb-3 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ scrollPaddingLeft: "1rem", WebkitOverflowScrolling: "touch" }}
        >
          {items.map((e, i) => (
            <div
              key={e.id}
              className="snap-start shrink-0 w-[84vw] max-w-[360px] rounded-xl border border-border/60 bg-card/70 overflow-hidden"
            >
              <EpisodeCard e={e} showTopics={showTopics} terms={terms} showEntities={showEntities} imagePriority={i === 0} />
            </div>
          ))}
          <div aria-hidden className="shrink-0 w-2" />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent"
        />
      </div>
      {desktop}
    </>
  );
}
