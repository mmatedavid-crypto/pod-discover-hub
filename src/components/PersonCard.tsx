import { Link } from "react-router-dom";
import PersonAvatar from "./PersonAvatar";

export interface PersonCardData {
  slug: string;
  name: string;
  disambiguation_label?: string | null;
  episode_count: number;
  podcast_count: number;
  latest_accepted_relevant_episode_at?: string | null;
  context_line?: string | null;
  short_bio?: string | null;
  ai_bio?: string | null;
}

// Safe Hungarian context line — short, no overconfident claims, omits weak/fallback text.
function buildContextLine(p: PersonCardData): string | null {
  if (p.context_line && p.context_line.trim()) return p.context_line.trim();
  if (p.disambiguation_label && p.disambiguation_label.trim()) return p.disambiguation_label.trim();
  const candidates = [p.short_bio, p.ai_bio];
  for (const raw of candidates) {
    if (!raw) continue;
    const t = raw.trim();
    if (!t) continue;
    // Skip the generic Hungarian fallback bio (it adds no value on a card)
    if (/magyar podcast epizódokban előforduló személy/i.test(t)) continue;
    // Take first sentence, cap length
    const firstSentence = t.split(/(?<=[.!?])\s+/)[0] || t;
    const trimmed = firstSentence.length > 140 ? firstSentence.slice(0, 137).trimEnd() + "…" : firstSentence;
    if (trimmed.length < 20) continue;
    return trimmed;
  }
  return null;
}

export default function PersonCard({ p }: { p: PersonCardData }) {
  const isFresh = p.latest_accepted_relevant_episode_at
    ? (Date.now() - new Date(p.latest_accepted_relevant_episode_at).getTime()) < 30 * 24 * 3600 * 1000
    : false;
  const context = buildContextLine(p);
  return (
    <Link
      to={`/szemelyek/${p.slug}`}
      className="group flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-border bg-card/60 hover:bg-card hover:border-primary/40 transition-colors"
    >
      <PersonAvatar name={p.name} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate leading-tight">{p.name}</div>
            {p.disambiguation_label && !context?.startsWith(p.disambiguation_label) && (
              <div className="text-xs text-muted-foreground truncate mt-0.5">{p.disambiguation_label}</div>
            )}
          </div>
          {isFresh && (
            <span className="shrink-0 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              Friss
            </span>
          )}
        </div>
        {context && (
          <div className="text-xs text-foreground/75 mt-1.5 line-clamp-2 leading-snug">{context}</div>
        )}
        <div className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1.5 flex-wrap">
          <span>{p.episode_count} epizód</span>
          <span aria-hidden>·</span>
          <span>{p.podcast_count} műsor</span>
        </div>
      </div>
    </Link>
  );
}
