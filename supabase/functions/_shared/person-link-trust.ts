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
 * Rows a person page may show and the role it may claim: rejected / needs_review never;
 * verified links keep their reviewed role; anything unreviewed (pending, in_progress,
 * accepted without a review record) is only a name mention, never a participant/subject.
 */
export function personPageMentionRows<T extends PersonMentionTrustRow>(rows: T[]): Array<{ row: T; role: PersonPageRole; verified: boolean }> {
  const out: Array<{ row: T; role: PersonPageRole; verified: boolean }> = [];
  for (const row of rows || []) {
    if (!row || isExcludedPersonMention(row)) continue;
    const verified = isVerifiedPersonMention(row);
    out.push({ row, role: verified ? declaredRole(row) : "mention", verified });
  }
  return out;
}
