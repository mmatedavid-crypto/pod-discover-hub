// Person ↔ episode link trust. A matching display name is NOT a verified shared identity
// (homonyms): only an accepted mention with a recorded review (validation_source) counts as a
// verified link. Mirrors public.person_link_trusted_v1 / get_episode_person_links_v1 in SQL.

export type PersonMentionTrustRow = {
  relevance_status?: string | null;
  validation_source?: string | null;
  role_type?: string | null;
  mention_type?: string | null;
};

export type PersonPageRole = "participant" | "subject" | "mention";

export function isVerifiedPersonMention(m: PersonMentionTrustRow): boolean {
  return m.relevance_status === "accepted" && Boolean(String(m.validation_source || "").trim());
}

export function isExcludedPersonMention(m: PersonMentionTrustRow): boolean {
  return m.relevance_status === "rejected" || m.relevance_status === "needs_review";
}

function declaredRole(m: PersonMentionTrustRow): PersonPageRole {
  const role = String(m.role_type || "");
  if (role === "participant" || role === "subject" || role === "mention") return role;
  const mt = String(m.mention_type || "");
  if (["host", "guest", "interviewee", "speaker", "archival_source"].includes(mt)) return "participant";
  if (mt === "subject") return "subject";
  return "mention";
}

/**
 * Rows a person page may show and the role it may claim. Rejected / needs_review never;
 * verified links keep their reviewed role. Unreviewed rows (pending, in_progress, accepted
 * without a review record) are only name occurrences: when the person has a verified link
 * anywhere (`personHasVerifiedLink`), a same-name unreviewed episode is not attached to that
 * identity at all (mirrors get_episode_person_links_v1); otherwise it is listed as a mention,
 * never as participant/subject. DB review decisions are never changed by this.
 */
export function personPageMentionRows<T extends PersonMentionTrustRow>(
  rows: T[],
  opts: { personHasVerifiedLink?: boolean } = {},
): Array<{ row: T; role: PersonPageRole; verified: boolean }> {
  const anchored = opts.personHasVerifiedLink === true || (rows || []).some((r) => r && isVerifiedPersonMention(r));
  const out: Array<{ row: T; role: PersonPageRole; verified: boolean }> = [];
  for (const row of rows || []) {
    if (!row || isExcludedPersonMention(row)) continue;
    const verified = isVerifiedPersonMention(row);
    if (!verified && anchored) continue;
    out.push({ row, role: verified ? declaredRole(row) : "mention", verified });
  }
  return out;
}
