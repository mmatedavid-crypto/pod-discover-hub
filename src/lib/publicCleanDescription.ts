// Public cleaned description (YouTube / Spotify show notes, owner-approved 2026-10-21).
// Served only by the get_episode_public_clean_description_v2 RPC; transcript text is never public.

export type PublicCleanDescription = {
  text: string;
  source: string;
  source_url: string | null;
};

const SOURCE_LABELS: Record<string, string> = {
  youtube: "YouTube-videó leírása",
  spotify: "Spotify-epizód leírása",
};

/** Attribution label for a public source; null for anything not approved for display. */
export function publicSourceLabel(source: string | null | undefined): string | null {
  return source ? SOURCE_LABELS[source] ?? null : null;
}

/** Validates the RPC payload; returns null unless the source is approved and the text is usable. */
export function parsePublicCleanDescription(raw: unknown): PublicCleanDescription | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === "string" ? r.text.trim() : "";
  const source = typeof r.source === "string" ? r.source : "";
  if (text.length < 40 || !publicSourceLabel(source)) return null;
  const url = typeof r.source_url === "string" && /^https:\/\/(www\.youtube\.com|youtu\.be|open\.spotify\.com)\//.test(r.source_url)
    ? r.source_url
    : null;
  return { text, source, source_url: url };
}
