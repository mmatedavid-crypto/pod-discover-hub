import { Link } from "react-router-dom";
import PersonAvatar from "./PersonAvatar";

export interface PersonCardData {
  slug: string;
  name: string;
  image_url?: string | null;
  disambiguation_label?: string | null;
  identity_ambiguous?: boolean | null;
  manual_approved?: boolean | null;
  ai_bio_status?: string | null;
  ai_bio_confidence?: number | null;
  wikipedia_match_status?: string | null;
  wikipedia_match_confidence?: number | null;
  episode_count: number;
  podcast_count: number;
  latest_accepted_relevant_episode_at?: string | null;
  context_line?: string | null;
  short_bio?: string | null;
  ai_bio?: string | null;
}

// Safe Hungarian context line — short, no overconfident claims, omits weak/fallback text.
export function isUsefulPersonIdentityLabel(label?: string | null): boolean {
  const value = String(label || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("hu-HU");
  if (!value) return false;
  if (/^(személy|közszereplő|közeleti szereplő|közéleti szereplő)$/i.test(value)) return false;
  if (/^nemzetközi( téma)? személy$/i.test(value)) return false;
  if (/^podcast(ok)?ban (előforduló|említett) személy$/i.test(value)) return false;
  return true;
}

export function buildPersonCardContextLine(p: PersonCardData): string | null {
  if (p.context_line && p.context_line.trim()) return p.context_line.trim();
  if (isUsefulPersonIdentityLabel(p.disambiguation_label)) return p.disambiguation_label!.trim();
  const ambiguous = Boolean(p.identity_ambiguous) && !p.manual_approved;
  const trustedWiki = p.wikipedia_match_status === "verified" && Number(p.wikipedia_match_confidence || 0) >= 0.8;
  const candidates = [p.short_bio, p.ai_bio];
  for (const raw of candidates) {
    if (!raw) continue;
    const t = raw.trim();
    if (!t) continue;
    if (ambiguous && !trustedWiki) continue;
    if (raw === p.ai_bio && p.ai_bio_status && p.ai_bio_status !== "completed") continue;
    if (raw === p.ai_bio && p.ai_bio_confidence != null && Number(p.ai_bio_confidence) < 0.75) continue;
    // Skip the generic Hungarian fallback bio (it adds no value on a card)
    if (/(magyar\s+)?podcast epizódokban előforduló személy/i.test(t)) continue;
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
  const context = buildPersonCardContextLine(p);
  return (
    <Link
      to={`/szemelyek/${p.slug}`}
      className="group flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-border bg-card/60 hover:bg-card hover:border-primary/40 transition-colors"
    >
      <PersonAvatar name={p.name} size="md" imageUrl={p.image_url} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate leading-tight">{p.name}</div>
            {isUsefulPersonIdentityLabel(p.disambiguation_label) && !context?.startsWith(p.disambiguation_label!) && (
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
