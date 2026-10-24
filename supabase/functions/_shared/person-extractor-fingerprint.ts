// Input fingerprint for person-entity-extractor (pure; unit-tested).
// The extractor is deterministic: its writes for an episode depend only on these inputs
// (plus the topic-alias set, folded in as aliasFp, and this policy version). An episode
// whose fingerprint is unchanged since its last successful write is skipped — no
// people/mention/topic-map rewrite churn on every catalog sweep.
export const PERSON_EXTRACTOR_INPUT_POLICY = "person-extractor-input-v1";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const arr = (v: unknown) => (Array.isArray(v) ? v.map(norm) : []);

export async function personExtractorInputFingerprint(
  e: { id: string; title?: string | null; ai_summary?: string | null; clean_text?: string | null; people?: unknown; mentioned?: unknown; topics?: unknown; published_at?: string | null; entity_extraction_evidence?: any },
  pod: { id: string; hosts?: unknown; language_decision?: string | null; title?: string | null } | null,
  aliasFp: string,
): Promise<string> {
  const pm = Array.isArray(e.entity_extraction_evidence?.person_mentions)
    ? e.entity_extraction_evidence.person_mentions.map((p: any) => [norm(p?.name), norm(p?.role), Number(p?.confidence || 0), norm(p?.evidence), norm(p?.source)])
    : [];
  return sha256Hex(JSON.stringify([
    PERSON_EXTRACTOR_INPUT_POLICY, aliasFp,
    e.id, norm(e.title), norm(e.ai_summary), norm(e.clean_text), arr(e.people), arr(e.mentioned), arr(e.topics), norm(e.published_at), pm,
    pod ? [pod.id, arr(pod.hosts), norm(pod.language_decision), norm(pod.title)] : null,
  ]));
}

export async function aliasSetFingerprint(rows: { topic_id: string; normalized_alias: string; weight: number }[]): Promise<string> {
  const keys = rows.map((r) => `${r.topic_id}|${r.normalized_alias}|${Number(r.weight || 0)}`).sort();
  return sha256Hex(keys.join("\n"));
}

/** Rows a decision was made on (AI/human/rule review) are never rewritten by the extractor. */
export function isReviewedMention(row: { validation_source?: string | null }): boolean {
  return !!row.validation_source;
}
