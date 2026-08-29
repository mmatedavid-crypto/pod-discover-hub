// Pure, dependency-free helpers for MCP entity resolution and safe response
// shaping. Kept side-effect free so unit tests and the build-time manifest
// extraction can import them without any env/IO.

export const PODIVERZUM_ORIGIN = "https://podiverzum.hu";

/** Accent + case folding used to match user-typed entity names against
 * `normalized_name` / `normalized_alias` columns. */
export function normalizeEntityText(input: string): string {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Trim an already-public extraction evidence phrase to a bounded length.
 * Never used for transcript text. */
export function clampEvidencePhrase(input: unknown, max: number): string | undefined {
  if (typeof input !== "string") return undefined;
  const s = input.replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function episodeUrl(podcastSlug?: string | null, episodeSlug?: string | null): string | undefined {
  if (!podcastSlug || !episodeSlug) return undefined;
  return `${PODIVERZUM_ORIGIN}/podcast/${podcastSlug}/${episodeSlug}`;
}

export function podcastUrl(slug?: string | null): string | undefined {
  return slug ? `${PODIVERZUM_ORIGIN}/podcast/${slug}` : undefined;
}

export function personUrl(slug?: string | null): string | undefined {
  return slug ? `${PODIVERZUM_ORIGIN}/szemelyek/${slug}` : undefined;
}

export function organizationUrl(slug?: string | null): string | undefined {
  return slug ? `${PODIVERZUM_ORIGIN}/ceg/${slug}` : undefined;
}

export function topicUrl(slug?: string | null): string | undefined {
  return slug ? `${PODIVERZUM_ORIGIN}/temak/${slug}` : undefined;
}

/** Mention rows we never surface publicly. */
export const REJECTED_MENTION_STATUSES = ["rejected", "duplicate", "invalid"] as const;

export function isSafePersonMentionRow(m: Record<string, any> | null | undefined): boolean {
  if (!m) return false;
  const status = String(m.relevance_status || "").toLowerCase();
  if ((REJECTED_MENTION_STATUSES as readonly string[]).includes(status)) return false;
  return true;
}

export function isPublicOrganizationRow(o: Record<string, any> | null | undefined): boolean {
  if (!o) return false;
  if (o.is_public === false) return false;
  if (["hide", "reject"].includes(String(o.ai_recommended_action || ""))) return false;
  return true;
}

/** Podcast rows we consider part of the public Hungarian catalog. */
export function isPublicHungarianPodcast(p: Record<string, any> | null | undefined): boolean {
  if (!p) return false;
  if (p.rss_status === "failed" || p.rss_status === "inactive") return false;
  const lang = String(p.language || "").toLowerCase();
  if (p.language_decision && p.language_decision !== "accept_hungarian") return false;
  return !p.language_decision ? lang.startsWith("hu") : true;
}

/** Fields that must never appear in any MCP tool response. */
export const FORBIDDEN_RESPONSE_KEYS = [
  "chunk_match",
  "content_snippet",
  "transcript",
  "segments",
  "ai_reason",
  "ai_evidence_phrases",
  "editorial_notes",
  "ai_review_summary",
  "source_evidence",
  "understanding",
  "cache_hit",
  "timing",
] as const;

/** Defensive recursive strip of forbidden keys before returning a payload. */
export function stripForbidden<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripForbidden(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((FORBIDDEN_RESPONSE_KEYS as readonly string[]).includes(k)) continue;
      if (v === undefined) continue;
      out[k] = stripForbidden(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** Shape one search-hybrid episode row into the public MCP result. */
export function shapeSearchEpisode(e: Record<string, any>): Record<string, unknown> {
  const podcast = e.podcasts || {};
  const summary =
    typeof e.ai_summary === "string" && e.ai_summary.trim()
      ? e.ai_summary
      : typeof e.summary === "string" && e.summary.trim()
        ? e.summary
        : typeof e.description === "string"
          ? e.description
          : "";
  return stripForbidden({
    id: e.id,
    title: e.display_title || e.title,
    slug: e.slug,
    published_at: e.published_at,
    summary: clampEvidencePhrase(summary, 600),
    podcast: {
      id: e.podcast_id,
      title: podcast.display_title || podcast.title,
      slug: podcast.slug,
      url: podcastUrl(podcast.slug),
    },
    why_matched: typeof e.why_matched === "string" ? e.why_matched : undefined,
    source_url: episodeUrl(podcast.slug, e.slug),
  });
}

/** Parse an episode reference: raw id, Podiverzum URL, or `podcast/episode` slug pair. */
export function parseEpisodeRef(ref: string): { id?: string; podcastSlug?: string; episodeSlug?: string } {
  const s = String(ref || "").trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return { id: s };
  const path = s.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "");
  const m = path.match(/(?:^|\/)podcast\/([^/]+)\/([^/]+)\/?$/);
  if (m) return { podcastSlug: decodeURIComponent(m[1]), episodeSlug: decodeURIComponent(m[2]) };
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 2) return { podcastSlug: parts[0], episodeSlug: parts[1] };
  if (parts.length === 1) return { episodeSlug: parts[0] };
  return {};
}
