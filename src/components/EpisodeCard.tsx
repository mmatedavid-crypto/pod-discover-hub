import { Link } from "react-router-dom";
import { PodcastCover } from "./PodcastCover";
import { ExternalLink } from "lucide-react";
import { highlightParts, snippet } from "@/lib/text";

export type EpisodeLite = {
  id: string;
  title: string;
  slug: string;
  summary?: string | null;
  description?: string | null;
  published_at?: string | null;
  audio_url?: string | null;
  episode_rank?: number | null;
  topics?: string[] | null;
  people?: string[] | null;
  companies?: string[] | null;
  tickers?: string[] | null;
  ingredients?: string[] | null;
  podcasts: {
    slug: string;
    title: string;
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
      {parts.map((p, i) => p.hit ? <mark key={i} className="bg-accent/40 text-foreground rounded px-0.5">{p.s}</mark> : <span key={i}>{p.s}</span>)}
    </>
  );
}

export function EpisodeCard({
  e, showTopics = false, terms, showEntities = false,
}: { e: EpisodeLite; showTopics?: boolean; terms?: string[]; showEntities?: boolean }) {
  const p = e.podcasts;
  const desc = snippet(e.summary || e.description, 220, terms);
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
    <article className="group flex gap-3 p-4 hover:bg-secondary/40 transition-colors">
      <Link to={`/podcast/${p.slug}`} className="shrink-0 w-16 sm:w-20">
        <PodcastCover title={p.title} src={p.image_url} size="sm" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/podcast/${p.slug}/${e.slug}`} className="font-medium leading-snug line-clamp-2 group-hover:underline">
          <HL text={e.title} terms={terms} />
        </Link>
        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-2 gap-y-0.5 items-center">
          <Link to={`/podcast/${p.slug}`} className="hover:text-foreground font-medium">{p.title}</Link>
          {p.category && <span>· {p.category}</span>}
          {e.published_at && <span>· {new Date(e.published_at).toLocaleDateString()}</span>}
          {typeof e.episode_rank === "number" && e.episode_rank > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-secondary text-[10px]">Ep rank {e.episode_rank}</span>
          )}
          {typeof p.podiverzum_rank === "number" && p.podiverzum_rank > 0 && (
            <span className="text-[10px] text-muted-foreground">/ Pod {p.podiverzum_rank}</span>
          )}
        </div>
        {desc && (
          <p className="text-sm text-muted-foreground line-clamp-2 mt-1.5">
            <HL text={desc} terms={terms} />
          </p>
        )}
        {(showTopics && e.topics && e.topics.length > 0) && (
          <div className="flex flex-wrap gap-1 mt-2">
            {e.topics.slice(0, 5).map((t) => (
              <Link key={t} to={`/topic/${encodeURIComponent(t.toLowerCase().replace(/[^a-z0-9]+/g,"-"))}`} className="px-2 py-0.5 rounded-full bg-secondary text-[11px] hover:bg-accent hover:text-accent-foreground">
                {t}
              </Link>
            ))}
          </div>
        )}
        {showEntities && allEnts.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {allEnts.map(({ kind, v }) => {
              const slug = kind === "ticker" ? v.replace(/[^a-zA-Z0-9.]+/g,"").toUpperCase() : v.toLowerCase().replace(/[^a-z0-9]+/g,"-");
              return (
                <Link key={`${kind}-${v}`} to={`/${kind}/${encodeURIComponent(slug)}`} className="px-2 py-0.5 rounded-full bg-secondary text-[11px] hover:bg-accent hover:text-accent-foreground">
                  {v}
                </Link>
              );
            })}
          </div>
        )}
        <div className="flex gap-3 mt-2 text-xs">
          <Link to={`/podcast/${p.slug}/${e.slug}`} className="text-muted-foreground hover:text-foreground">Open episode</Link>
          {e.audio_url && (
            <a href={e.audio_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3 w-3" /> Listen
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function EpisodeList({
  items, showTopics = false, empty = "No episodes yet.", terms, showEntities = false,
}: { items: EpisodeLite[]; showTopics?: boolean; empty?: string; terms?: string[]; showEntities?: boolean }) {
  if (!items.length) return <div className="text-muted-foreground text-sm p-4">{empty}</div>;
  return (
    <ul className="divide-y divide-border border border-border rounded-lg bg-card">
      {items.map((e) => (
        <li key={e.id}>
          <EpisodeCard e={e} showTopics={showTopics} terms={terms} showEntities={showEntities} />
        </li>
      ))}
    </ul>
  );
}
