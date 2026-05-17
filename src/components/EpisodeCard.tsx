import { Link } from "react-router-dom";
import { PodcastCover } from "./PodcastCover";
import { ExternalLink } from "lucide-react";
import { highlightParts, snippet } from "@/lib/text";
import { freshnessOf, relativeTime } from "@/lib/freshness";

export type EpisodeLite = {
  id: string;
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
  companies?: string[] | null;
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
          {p.category && <span className="opacity-60">·</span>}
          {p.category && <span>{p.category}</span>}
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
          {typeof p.podiverzum_rank === "number" && p.podiverzum_rank > 0 && (
            <span
              className="px-1.5 py-0.5 rounded-md border border-border bg-card text-[10px] font-medium text-muted-foreground"
              title="A Podiverzum forrásminőség-jelzése: relevancia, frissesség, állandóság és feed-állapot alapján."
            >
              Forrás {Number(p.podiverzum_rank).toFixed(1)}
            </span>
          )}
          {e.matchBadge && (
            <span className="px-1.5 py-0.5 rounded-md border border-border bg-secondary text-[10px] font-medium text-foreground/80">{e.matchBadge}</span>
          )}
        </div>
        {e.why_matched && (
          <p className="text-[12px] mt-2 px-2.5 py-1.5 rounded-md border border-primary/40 bg-primary/10 text-foreground leading-snug">
            <span className="font-semibold text-primary mr-1">Miért releváns:</span>
            {e.why_matched}
          </p>
        )}
        {desc && (
          <p className="text-sm text-muted-foreground line-clamp-2 mt-2 leading-relaxed">
            <HL text={desc} terms={terms} />
          </p>
        )}
        {(showTopics && e.topics && e.topics.length > 0) && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {e.topics.slice(0, 5).map((t) => (
              <Link key={t} to={`/topic/${encodeURIComponent(t.toLowerCase().replace(/[^a-z0-9]+/g,"-"))}`} className="px-2 py-0.5 rounded-full border border-border bg-card text-[11px] hover:border-primary/50 hover:bg-primary/10 hover:text-foreground transition-colors">
                {t}
              </Link>
            ))}
          </div>
        )}
        {showEntities && allEnts.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {allEnts.map(({ kind, v }) => {
              const slug = kind === "ticker" ? v.replace(/[^a-zA-Z0-9.]+/g,"").toUpperCase() : v.toLowerCase().replace(/[^a-z0-9]+/g,"-");
              return (
                <Link key={`${kind}-${v}`} to={`/${kind}/${encodeURIComponent(slug)}`} className="px-2 py-0.5 rounded-full border border-border bg-card text-[11px] hover:border-primary/50 hover:bg-primary/10 hover:text-foreground transition-colors">
                  {v}
                </Link>
              );
            })}
          </div>
        )}
        <div className="flex gap-3 mt-2.5 text-xs">
          <Link to={`/podcast/${p.slug}/${e.slug}`} className="text-muted-foreground hover:text-foreground">Részletek</Link>
          {e.audio_url && (
            <a href={e.audio_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3 w-3" /> Hallgatás
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function EpisodeList({
  items, showTopics = false, empty = "Még nincsenek epizódok.", terms, showEntities = false, scrollOnMobile = false,
}: { items: EpisodeLite[]; showTopics?: boolean; empty?: string; terms?: string[]; showEntities?: boolean; scrollOnMobile?: boolean }) {
  if (!items.length) return <div className="text-muted-foreground text-sm p-4">{empty}</div>;
  const desktop = (
    <ul className={`${scrollOnMobile ? "hidden sm:block " : ""}divide-y divide-border/70 border border-border/70 rounded-xl bg-card/60 surface overflow-hidden`}>
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
          {/* Trailing spacer ensures the last card can fully snap to the left edge */}
          <div aria-hidden className="shrink-0 w-2" />
        </div>
        {/* Right-edge fade hints scrollability */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent"
        />
      </div>
      {desktop}
    </>
  );
}