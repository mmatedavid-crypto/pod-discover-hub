// Person-first evidence ranking for full-name search (hybrid search only).
// Order: accepted participant links -> accepted subject -> accepted mention ->
// pending links that are also verified by a complete-name text match -> text-only
// matches. Rejected links never count as evidence. A text match or link never
// asserts which real person it is when the catalog identity is unconfirmed.
import { createFullNameMatcher, foldSearchName, nameEvidenceTier, type NameSearchEpisode } from "./search-name-match.ts";

export type PersonCandidate = {
  id: string; name: string; slug: string | null; verified: boolean;
  disambiguation_label?: string | null; gated_episode_count?: number | null;
  identity_ambiguous?: boolean | null;
};

export type PersonLink = {
  person_id: string; episode_id: string; relevance_status: string | null;
  mention_type?: string | null; role_type?: string | null;
};

export type EvidenceKind =
  | "accepted_participant" | "accepted_subject" | "accepted_mention"
  | "pending_link" | "title_text" | "people_text" | "body_text";

const KIND_SCORE: Record<EvidenceKind, number> = {
  accepted_participant: 600, accepted_subject: 500, accepted_mention: 400,
  pending_link: 300, title_text: 230, people_text: 220, body_text: 210,
};

export type NameEvidence = {
  kind: EvidenceKind; label: string; identity_unconfirmed: boolean; person_slug?: string | null;
};

// Public, non-hidden catalog rows may contribute links; only `verified` rows may
// be presented as a confirmed identity (person pin).
export function isPersonEvidenceCandidate(p: any): boolean {
  if (!p || p.is_public !== true || p.is_indexable !== true) return false;
  if (!["indexable", "manual_approved", "active", null, undefined].includes(p.activation_status)) return false;
  if (["hide", "reject"].includes(p.ai_recommended_action || "")) return false;
  if (p.identity_status === "split_resolved") return false;
  return true;
}

function linkRole(link: PersonLink): "participant" | "subject" | "mention" {
  const role = String(link.role_type || "").toLowerCase();
  if (role === "participant" || role === "host" || role === "guest") return "participant";
  if (role === "subject") return "subject";
  if (role === "mention") return "mention";
  const mt = String(link.mention_type || "").toLowerCase();
  if (["host", "guest", "participant", "cohost", "co_host"].includes(mt)) return "participant";
  if (mt === "subject") return "subject";
  return "mention";
}

function linkKind(link: PersonLink): EvidenceKind | null {
  const status = String(link.relevance_status || "").toLowerCase();
  if (status === "rejected") return null;
  if (status !== "accepted") return "pending_link";
  const role = linkRole(link);
  return role === "participant" ? "accepted_participant" : role === "subject" ? "accepted_subject" : "accepted_mention";
}

function labelFor(kind: EvidenceKind, link: PersonLink | null, unconfirmed: boolean): string {
  let label: string;
  if (kind === "accepted_participant") label = String(link?.mention_type || "").toLowerCase() === "host" ? "Műsorvezető" : "Vendég";
  else if (kind === "accepted_subject") label = "Róla szól";
  else if (kind === "accepted_mention") label = "Említés";
  else if (kind === "pending_link") label = "Nem ellenőrzött kapcsolat";
  else label = "Szöveges találat";
  const isLink = kind.startsWith("accepted_") || kind === "pending_link";
  return isLink && unconfirmed ? `${label} · azonosság nem igazolt` : label;
}

function dedupeKey(e: any): string {
  const title = foldSearchName(String(e.display_title || e.title || ""));
  return title ? `${title}|${String(e.published_at || "").slice(0, 10)}` : `id:${e.id}`;
}

export type RankPersonEvidenceInput<T> = {
  episodes: T[]; names: string[]; links: PersonLink[]; candidates: PersonCandidate[];
  cleanTextEpisodeIds?: ReadonlySet<string>;
};

export function rankPersonEvidence<T extends NameSearchEpisode & { published_at?: string | null }>(
  input: RankPersonEvidenceInput<T>,
): Array<T & { name_evidence: NameEvidence }> {
  const matches = createFullNameMatcher(input.names);
  const byPerson = new Map(input.candidates.map((c) => [c.id, c]));
  const multiple = input.candidates.length > 1;
  const bestLink = new Map<string, { kind: EvidenceKind; link: PersonLink }>();
  for (const link of input.links) {
    if (!byPerson.has(link.person_id)) continue;
    const kind = linkKind(link);
    if (!kind) continue;
    const cur = bestLink.get(link.episode_id);
    if (!cur || KIND_SCORE[kind] > KIND_SCORE[cur.kind]) bestLink.set(link.episode_id, { kind, link });
  }
  const seenIds = new Set<string>();
  const scored: Array<{ e: T; ev: NameEvidence; score: number; text: number; date: number; idx: number }> = [];
  input.episodes.forEach((e, idx) => {
    const id = String(e.id || "");
    if (!id || seenIds.has(id)) return;
    seenIds.add(id);
    const text = Math.max(nameEvidenceTier(e, matches), input.cleanTextEpisodeIds?.has(id) ? 1 : 0);
    const best = bestLink.get(id);
    let kind: EvidenceKind | null = null;
    let link: PersonLink | null = null;
    // Pending links require a visible complete-name match (keeps split-name fix).
    if (best && (best.kind !== "pending_link" || text > 0)) { kind = best.kind; link = best.link; }
    else if (text === 3) kind = "title_text";
    else if (text === 2) kind = "people_text";
    else if (text === 1) kind = "body_text";
    if (!kind) return;
    const person = link ? byPerson.get(link.person_id) : undefined;
    const unconfirmed = link ? (multiple || !person?.verified) : true;
    scored.push({
      e, idx, text, score: KIND_SCORE[kind], date: Date.parse(String(e.published_at || "")) || 0,
      ev: { kind, label: labelFor(kind, link, unconfirmed), identity_unconfirmed: unconfirmed, person_slug: link ? person?.slug ?? null : undefined },
    });
  });
  scored.sort((a, b) => b.score - a.score || b.text - a.text || b.date - a.date || a.idx - b.idx);
  const seenKeys = new Set<string>();
  const out: Array<T & { name_evidence: NameEvidence }> = [];
  for (const s of scored) {
    const key = dedupeKey(s.e);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push({ ...s.e, name_evidence: s.ev });
  }
  return out;
}

export function personIdentityState(candidates: PersonCandidate[]): "none" | "verified" | "unconfirmed" | "multiple" {
  if (candidates.length === 0) return "none";
  if (candidates.length > 1) return "multiple";
  return candidates[0].verified ? "verified" : "unconfirmed";
}

// Accent-preserving phrase query for the `simple` FTS index on clean text.
// Tokens are letters/digits only, so the result is always valid tsquery syntax.
export function cleanTextNameTsQuery(names: string[]): string | null {
  const parts = new Set<string>();
  for (const name of names) {
    for (const variant of [String(name || "").toLowerCase(), foldSearchName(name)]) {
      const tokens = variant.match(/[\p{L}\p{N}]+/gu) || [];
      if (tokens.length < 2 || tokens.length > 4) continue;
      parts.add(`(${tokens.map((t, i) => `${t}${i === tokens.length - 1 ? ":*" : ""}`).join(" <-> ")})`);
    }
  }
  return parts.size ? [...parts].slice(0, 6).join(" | ") : null;
}
