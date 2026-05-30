import { Link } from "react-router-dom";
import { PodcastCover } from "./PodcastCover";
import { Brain, Info, Play } from "lucide-react";
import { highlightParts, snippet } from "@/lib/text";
import { freshnessOf, relativeTime } from "@/lib/freshness";
import { slugify } from "@/lib/slug";
import { entitySlug } from "@/lib/entity";
import { EpisodeMarks } from "./EpisodeMarks";
import { useSmartPlayer } from "./smart-player/SmartPlayerProvider";
import { detectAudioSource } from "@/lib/playerAudio";
import { getEpisodeUnderstanding } from "@/lib/episodeUnderstanding";
import { categoryLabel } from "@/lib/categoryLabels";

export type EpisodeLite = {
  id: string;
  podcast_id?: string | null;
  title: string;
  display_title?: string | null;
  slug: string;
  ai_summary?: string | null;
  summary?: string | null;
  description?: string | null;
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

export function EpisodeCard({
  e, showTopics = false, terms, showEntities = false,
}: { e: EpisodeLite; showTopics?: boolean; terms?: string[]; showEntities?: boolean }) {
  const p = e.podcasts;
  const epTitle = e.display_title || e.title;
  const podTitle = p.display_title || p.title;
  const desc = snippet(e.ai_summary || e.summary || e.description, 220, terms);
  const understanding = getEpisodeUnderstanding(e);
  const categoryName = categoryLabel(p.category);
  const { play } = useSmartPlayer();
  const playable = detectAudioSource({ audio_url: e.audio_url });
  const playerAudioUrl = playable?.url || e.audio_url || null;
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
      imageUrl: p.image_url || null,
      audioUrl: playerAudioUrl,
      externalUrl: e.audio_url || null,
    }, { resume: true });
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
          <PodcastCover title={podTitle} src={p.image_url} size="sm" />
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
        {e.why_matched && (
          <p className="text-[12px] mt-2 px-2.5 py-1.5 rounded-md border border-primary/40 bg-primary/10 text-foreground leading-snug">
            <span className="font-semibold text-primary mr-1">Miért releváns:</span>
            {e.why_matched}
          </p>
        )}
        {!e.why_matched && understanding && (
          <p className="text-[12px] mt-2 px-2.5 py-1.5 rounded-md border border-primary/30 bg-primary/5 text-foreground/85 leading-snug line-clamp-2">
            <span className="font-semibold text-primary mr-1">A lényeg:</span>
            {understanding.headline}
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
              <Link key={t} to={`/topic/${encodeURIComponent(slugify(t))}`} className="px-2 py-0.5 rounded-full border border-border bg-card text-[11px] hover:border-primary/50 hover:bg-primary/10 hover:text-foreground transition-colors">
                {t}
              </Link>
            ))}
          </div>
        )}
        {showEntities && allEnts.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {allEnts.map(({ kind, v }) => {
              const slug = entitySlug(kind as any, v);
              return (
                <Link key={`${kind}-${v}`} to={`/${kind}/${encodeURIComponent(slug)}`} className="px-2 py-0.5 rounded-full border border-border bg-card text-[11px] hover:border-primary/50 hover:bg-primary/10 hover:text-foreground transition-colors">
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
          <div className="ml-auto"><EpisodeMarks episodeId={e.id} compact /></div>
        </div>
      </div>
    </article>
  );
}

function EpisodeRailCard({
  e, showTopics = false, terms, showEntities = false,
}: { e: EpisodeLite; showTopics?: boolean; terms?: string[]; showEntities?: boolean }) {
  const p = e.podcasts;
  const epTitle = e.display_title || e.title;
  const podTitle = p.display_title || p.title;
  const desc = snippet(e.ai_summary || e.summary || e.description, 170, terms);
  const understanding = getEpisodeUnderstanding(e);
  const categoryName = categoryLabel(p.category);
  const { play } = useSmartPlayer();
  const playable = detectAudioSource({ audio_url: e.audio_url });
  const playerAudioUrl = playable?.url || e.audio_url || null;
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
      imageUrl: p.image_url || null,
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
          <div className="absolute inset-0 scale-110 opacity-35 blur-xl">
            <PodcastCover title={podTitle} src={p.image_url} size="lg" className="h-full rounded-none border-0" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/45 to-transparent" />
          <div className="absolute left-3 top-3 w-16 rounded-md shadow-lg ring-1 ring-border/70 sm:w-20">
            <PodcastCover title={podTitle} src={p.image_url} size="sm" />
          </div>
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
            <div className="text-[11px] font-medium text-foreground/80 line-clamp-1">{podTitle}</div>
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
              <Link key={t} to={`/topic/${encodeURIComponent(slugify(t))}`} className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground">
                {t}
              </Link>
            ))}
          </div>
        )}
        {showEntities && allEnts.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {allEnts.map(({ kind, v }) => {
              const slug = entitySlug(kind as any, v);
              return (
                <Link key={`${kind}-${v}`} to={`/${kind}/${encodeURIComponent(slug)}`} className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground">
                  {v}
                </Link>
              );
            })}
          </div>
        )}
        <div className="mt-auto flex items-center gap-2 pt-3 text-xs">
          <Link to={`/podcast/${p.slug}/${e.slug}`} className="text-muted-foreground hover:text-foreground">Részletek</Link>
          <div className="ml-auto"><EpisodeMarks episodeId={e.id} compact /></div>
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
          {items.map((e) => (
            <div
              key={e.id}
              className="snap-start shrink-0 w-[78vw] max-w-[340px] sm:w-[340px]"
            >
              <EpisodeRailCard e={e} showTopics={showTopics} terms={terms} showEntities={showEntities} />
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
      {items.map((e) => (
        <li key={e.id} className="transition-colors">
          <EpisodeCard e={e} showTopics={showTopics} terms={terms} showEntities={showEntities} />
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
          {items.map((e) => (
            <div
              key={e.id}
              className="snap-start shrink-0 w-[84vw] max-w-[360px] rounded-xl border border-border/60 bg-card/70 overflow-hidden"
            >
              <EpisodeCard e={e} showTopics={showTopics} terms={terms} showEntities={showEntities} />
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
