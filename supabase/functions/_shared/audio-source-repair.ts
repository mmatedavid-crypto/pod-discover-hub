// Pure deterministic logic for audio source verification, conservative publisher RSS episode
// matching, safe same-host URL canonicalization, and verified episode-level fallback selection.
// Zero network I/O, zero paid AI — shared by audio-source-repair edge function and Vitest tests.
import { normHu, titleSim } from "./title-similarity.ts";
import type { FeedItem } from "./rss.ts";

export type ProbeVerdict = "valid_audio" | "definitive_dead" | "inconclusive";

export type ProbeClassification = {
  verdict: ProbeVerdict;
  format: string | null;
  reason: string;
};

export type EpisodeForMatch = {
  title: string;
  guid?: string | null;
  published_at?: string | null;
  duration_seconds?: number | null;
  audio_url?: string | null;
};

export type FeedMatchResult = {
  item: FeedItem;
  method: "rss_guid" | "rss_title_date_duration";
  evidence: Record<string, unknown>;
};

export type ExternalAltCandidate = {
  field: "spotify_url" | "apple_url" | "youtube_url" | "episode_url";
  url: string;
  source: string;
  needsHttpCheck: boolean;
};

const TEXT_HTML_PREFIXES = [
  "<!doctype", "<html", "<head", "<body", "<script", "<?xml", "<rss", "<feed", "{", "[",
];

const NON_AUDIO_MIME_PREFIXES = [
  "text/html", "application/xhtml", "text/xml", "application/xml",
  "application/json", "text/plain", "image/",
];

function asciiPrefix(bytes: Uint8Array, max = 96): string {
  const len = Math.min(bytes.length, max);
  let out = "";
  for (let i = 0; i < len; i++) {
    const b = bytes[i];
    if (b === 0) continue;
    out += String.fromCharCode(b);
  }
  return out.trimStart().toLowerCase();
}

export function looksLikeTextOrHtml(bytes: Uint8Array, contentType: string): boolean {
  const ct = (contentType || "").toLowerCase().split(";")[0].trim();
  if (NON_AUDIO_MIME_PREFIXES.some((p) => ct.startsWith(p))) return true;
  if (bytes.length > 0) {
    const head = asciiPrefix(bytes, 64);
    if (TEXT_HTML_PREFIXES.some((p) => head.startsWith(p))) return true;
  }
  return false;
}

function isValidMpegFrameHeader(b0: number, b1: number, b2: number): boolean {
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return false;
  const versionBits = (b1 >> 3) & 0x03; // 01 reserved
  const layerBits = (b1 >> 1) & 0x03;   // 00 reserved
  const bitrateIdx = (b2 >> 4) & 0x0f;  // 0000 free, 1111 bad
  const sampleRateIdx = (b2 >> 2) & 0x03; // 11 reserved
  return versionBits !== 0x01 && layerBits !== 0x00 && bitrateIdx !== 0x00 && bitrateIdx !== 0x0f && sampleRateIdx !== 0x03;
}

export function hasAudioMagicBytes(bytes: Uint8Array, contentType: string, url: string): { valid: boolean; format: string | null } {
  if (bytes.length < 12) return { valid: false, format: null };
  // ID3v2 tag ("ID3")
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return { valid: true, format: "mp3_id3" };
  }
  // Ogg ("OggS")
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return { valid: true, format: "ogg" };
  }
  // FLAC ("fLaC")
  if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
    return { valid: true, format: "flac" };
  }
  // RIFF WAVE ("RIFF....WAVE")
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45
  ) {
    return { valid: true, format: "wav" };
  }
  // ISO BMFF / M4A / MP4 ("....ftyp")
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return { valid: true, format: "mp4_m4a" };
  }
  // Matroska / WebM EBML header
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { valid: true, format: "webm_mka" };
  }
  // ADTS AAC sync (0xFFF1 or 0xFFF9)
  if (bytes[0] === 0xff && (bytes[1] === 0xf1 || bytes[1] === 0xf9)) {
    return { valid: true, format: "aac_adts" };
  }
  // Scan first 4 KB for a valid MPEG audio frame sync (handles leading zero padding)
  const scanLimit = Math.min(bytes.length - 3, 4096);
  for (let i = 0; i < scanLimit; i++) {
    if (isValidMpegFrameHeader(bytes[i], bytes[i + 1], bytes[i + 2])) {
      return { valid: true, format: "mpeg_frame" };
    }
  }
  // HLS playlist only when URL & MIME clearly match m3u8
  const ct = (contentType || "").toLowerCase();
  if (/\.m3u8(\?|#|$)/i.test(url) && (ct.includes("mpegurl") || asciiPrefix(bytes, 16).startsWith("#extm3u"))) {
    return { valid: true, format: "hls_m3u8" };
  }
  return { valid: false, format: null };
}

export function classifyProbeOutcome(opts: {
  status: number;
  contentType: string;
  contentLength: number | null;
  bytes: Uint8Array;
  finalUrl: string;
}): ProbeClassification {
  const { status, contentType, contentLength, bytes, finalUrl } = opts;
  const ct = (contentType || "").toLowerCase().split(";")[0].trim();

  // Definitive missing/deleted HTTP codes
  if (status === 404 || status === 410) {
    return { verdict: "definitive_dead", format: null, reason: `http_${status}` };
  }

  // Server/geo/rate/transient errors: NEVER globally disable working audio on these!
  if (status === 401 || status === 403 || status === 406 || status === 429 || status === 451) {
    return { verdict: "inconclusive", format: null, reason: `http_${status}_access_or_rate` };
  }
  if (status >= 500 || status < 200 || status >= 400) {
    return { verdict: "inconclusive", format: null, reason: `http_${status}` };
  }

  // 200 / 206 responses: reject HTML/XML/JSON/empty bodies immediately
  if (looksLikeTextOrHtml(bytes, ct)) {
    return { verdict: "definitive_dead", format: null, reason: `non_audio_content:${ct || "html_or_text"}` };
  }
  if (bytes.length < 64 || (contentLength !== null && contentLength >= 0 && contentLength < 1024)) {
    return { verdict: "definitive_dead", format: null, reason: "empty_or_tiny_body" };
  }

  const magic = hasAudioMagicBytes(bytes, ct, finalUrl);
  if (magic.valid) {
    return { verdict: "valid_audio", format: magic.format, reason: `magic:${magic.format}` };
  }

  // Explicit audio/* or video/mp4 MIME with substantial non-HTML binary payload
  if ((ct.startsWith("audio/") || ct === "video/mp4") && bytes.length >= 256) {
    return { verdict: "valid_audio", format: ct, reason: `mime:${ct}` };
  }

  // Generic binary stream without recognized magic bytes: stay conservative (inconclusive)
  return { verdict: "inconclusive", format: null, reason: `unverified_binary:${ct || "unknown"}` };
}

/**
 * Never disable working audio from a client error alone, timeout, geo-block, or server block.
 * Recent successful listening (play_25..play_complete) overrides inconclusive probes and any
 * progress AFTER the last error confirms the stream works for listeners.
 */
export function decideAfterProbe(opts: {
  probeVerdict: ProbeVerdict;
  recentProgressCount: number;
  recentProgressAfterLastError: number;
}): "already_ok" | "needs_repair" | "defer" {
  if (opts.probeVerdict === "valid_audio") return "already_ok";
  if (opts.recentProgressAfterLastError > 0) return "already_ok";
  if (opts.probeVerdict === "inconclusive") {
    if (opts.recentProgressCount >= 2) return "already_ok";
    return "defer";
  }
  // probeVerdict === "definitive_dead" and no listener succeeded after the error
  return "needs_repair";
}

function normGuid(g: string | null | undefined): string {
  return (g || "").trim().toLowerCase();
}

function normUrl(u: string | null | undefined): string {
  return (u || "").trim();
}

function hoursDiff(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.abs(ta - tb) / 3_600_000;
}

function durationMatches(a: number | null | undefined, b: number | null | undefined): boolean {
  if (!a || !b || a <= 0 || b <= 0) return false;
  const diff = Math.abs(a - b);
  return diff <= 12 || diff / Math.max(a, b) <= 0.03;
}

/**
 * Conservative episode matching strictly inside the same confirmed podcast's live RSS feed:
 *  1. Unique exact GUID match with a different non-empty audio_url.
 *  2. Unique conservative title + (date within ±72h OR exact-title + duration within ±3%/12s).
 * Ambiguous (2+ matching items) returns null.
 */
export function matchEpisodeInFeedItems(ep: EpisodeForMatch, items: FeedItem[]): FeedMatchResult | null {
  const currentUrl = normUrl(ep.audio_url);
  const withAudio = items.filter((it) => {
    const u = normUrl(it.audio_url);
    return u.length >= 8 && /^https?:\/\//i.test(u) && u !== currentUrl;
  });
  if (!withAudio.length) return null;

  // 1. Exact GUID match (unique)
  const targetGuid = normGuid(ep.guid);
  if (targetGuid.length >= 6) {
    const guidHits = withAudio.filter((it) => normGuid(it.guid) === targetGuid);
    if (guidHits.length === 1) {
      const hit = guidHits[0];
      return {
        item: hit,
        method: "rss_guid",
        evidence: {
          guid: hit.guid,
          item_title: hit.title,
          published_diff_hours: hoursDiff(ep.published_at, hit.published),
        },
      };
    }
    if (guidHits.length > 1) return null; // ambiguous duplicate GUIDs
  }

  // 2. Conservative title + date/duration match (unique)
  const epNorm = normHu(ep.title);
  const epTokens = epNorm.split(" ").filter((t) => t.length >= 2);
  if (epNorm.length < 10 || epTokens.length < 2) return null;

  const scored: Array<{ item: FeedItem; sim: number; exact: boolean; hDiff: number | null; durOk: boolean }> = [];
  for (const it of withAudio) {
    const itNorm = normHu(it.title);
    if (!itNorm) continue;
    const exact = itNorm === epNorm;
    const sim = exact ? 1 : titleSim(ep.title, it.title);
    const hDiff = hoursDiff(ep.published_at, it.published);
    const durOk = durationMatches(ep.duration_seconds, it.duration_seconds);

    const dateOk = hDiff !== null && hDiff <= 72;
    // Require high title similarity + date within 3 days, OR exact long title + matching duration
    const passes =
      (sim >= 0.88 && dateOk) ||
      (exact && epNorm.length >= 15 && durOk);

    if (passes) scored.push({ item: it, sim, exact, hDiff, durOk });
  }

  if (scored.length !== 1) return null; // must be strictly unique!
  const winner = scored[0];
  return {
    item: winner.item,
    method: "rss_title_date_duration",
    evidence: {
      title_similarity: Number(winner.sim.toFixed(4)),
      exact_title: winner.exact,
      published_diff_hours: winner.hDiff !== null ? Number(winner.hDiff.toFixed(2)) : null,
      duration_match: winner.durOk,
      item_title: winner.item.title,
      item_guid: winner.item.guid || null,
    },
  };
}

/**
 * Strictly conservative same-host canonical URL repairs (e.g. double-encoded %25XX paths on
 * archive.org or legacy Buzzsprout paths missing `/episodes/`). Every candidate is still
 * verified via live audio byte probe before acceptance.
 */
export function deriveSafeHostCanonicalCandidates(audioUrl: string): Array<{ url: string; method: string }> {
  const out: Array<{ url: string; method: string }> = [];
  const raw = (audioUrl || "").trim();
  if (!raw) return out;
  let u: URL;
  try { u = new URL(raw); } catch { return out; }

  // 1. Double-percent-encoded path segments (%2520 → %20 etc.) on same host
  if (/%25[0-9a-f]{2}/i.test(u.pathname)) {
    const fixedPath = u.pathname.replace(/%25([0-9a-f]{2})/gi, "%$1");
    if (fixedPath !== u.pathname) {
      const cand = new URL(u.toString());
      cand.pathname = fixedPath;
      out.push({ url: cand.toString(), method: "same_host_double_encoding_fix" });
    }
  }

  // 2. Buzzsprout legacy path: /<showId>/<epId>-<slug>.mp3 → /<showId>/episodes/<epId>-<slug>.mp3
  if (u.hostname.toLowerCase().endsWith("buzzsprout.com")) {
    const m = u.pathname.match(/^\/(\d+)\/(\d+-[^/]+\.(?:mp3|m4a|ogg|wav))$/i);
    if (m) {
      const cand = new URL(u.toString());
      cand.pathname = `/${m[1]}/episodes/${m[2]}`;
      out.push({ url: cand.toString(), method: "buzzsprout_episodes_path" });
    }
  }

  // 3. Plain HTTP → HTTPS on identical host + path
  if (u.protocol === "http:") {
    const cand = new URL(u.toString());
    cand.protocol = "https:";
    out.push({ url: cand.toString(), method: "same_host_https_upgrade" });
  }

  return out;
}

function isDirectAudioLikeUrl(raw: string): boolean {
  return /\.(mp3|m4a|mp4|aac|wav|ogg|oga|opus|webm|m3u8)(\?|#|$)/i.test(raw);
}

function isSafeHttpUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

function sameOriginPath(a: URL | null, b: URL | null): boolean {
  return !!a && !!b && a.origin === b.origin && a.pathname === b.pathname;
}

/**
 * Collects verified episode-level alternative links (NEVER show-level pages, NEVER the broken stream).
 * Priority: verified Spotify episode > confirmed YouTube video > Apple episode > publisher episode page.
 */
export function collectVerifiedEpisodeAlternatives(ep: {
  audio_url?: string | null;
  spotify_url?: string | null;
  apple_url?: string | null;
  youtube_url?: string | null;
  episode_url?: string | null;
  best_spotify_meta_url?: string | null;
  best_spotify_meta_confidence?: number | null;
  confirmed_youtube_video_id?: string | null;
}): ExternalAltCandidate[] {
  const audioParsed = isSafeHttpUrl(ep.audio_url);
  const out: ExternalAltCandidate[] = [];
  const seen = new Set<string>();

  const push = (field: ExternalAltCandidate["field"], raw: string | null | undefined, source: string, needsHttpCheck: boolean, validator?: (u: URL) => boolean) => {
    const u = isSafeHttpUrl(raw);
    if (!u) return;
    if (sameOriginPath(u, audioParsed)) return;
    if (isDirectAudioLikeUrl(u.href)) return;
    if (validator && !validator(u)) return;
    if (seen.has(u.href)) return;
    seen.add(u.href);
    out.push({ field, url: u.href, source, needsHttpCheck });
  };

  const isSpotifyEpisode = (u: URL) =>
    u.hostname.toLowerCase() === "open.spotify.com" && /^\/episode\/[A-Za-z0-9]{10,}/.test(u.pathname);
  const isAppleEpisode = (u: URL) =>
    u.hostname.toLowerCase().endsWith("podcasts.apple.com") && u.searchParams.has("i");
  const isYoutubeVideo = (u: URL) => {
    const h = u.hostname.toLowerCase();
    if (h === "youtu.be") return u.pathname.length >= 8;
    return (h === "youtube.com" || h === "www.youtube.com" || h === "m.youtube.com") &&
      ((u.pathname === "/watch" && (u.searchParams.get("v") || "").length >= 8) || /^\/live\/[A-Za-z0-9_-]{8,}/.test(u.pathname));
  };

  // 1. Existing episode-level Spotify URL or high-confidence episode_spotify_meta
  push("spotify_url", ep.spotify_url, "existing_spotify_url", false, isSpotifyEpisode);
  if ((ep.best_spotify_meta_confidence ?? 0) >= 0.85) {
    push("spotify_url", ep.best_spotify_meta_url, "episode_spotify_meta", false, isSpotifyEpisode);
  }

  // 2. Existing episode-level YouTube URL or confirmed episode_youtube_links
  push("youtube_url", ep.youtube_url, "existing_youtube_url", false, isYoutubeVideo);
  if (ep.confirmed_youtube_video_id && /^[A-Za-z0-9_-]{8,20}$/.test(ep.confirmed_youtube_video_id)) {
    push("youtube_url", `https://www.youtube.com/watch?v=${ep.confirmed_youtube_video_id}`, "episode_youtube_links_confirmed", false, isYoutubeVideo);
  }

  // 3. Existing episode-level Apple Podcasts URL (must have ?i= episode parameter)
  push("apple_url", ep.apple_url, "existing_apple_url", false, isAppleEpisode);

  // 4. Publisher episode page (requires HTTP liveness check so we never point to a 404 Buzzsprout page)
  push("episode_url", ep.episode_url, "existing_episode_url", true, (u) => {
    // Reject bare homepage links without a path
    return u.pathname.length > 1;
  });

  return out;
}

export function nextBackoffMinutes(attempts: number, baseMinutes = 360): number {
  const exp = Math.min(5, Math.max(0, attempts - 1));
  return Math.min(7 * 24 * 60, Math.round(baseMinutes * Math.pow(2, exp)));
}

/**
 * Targeted maintenance items (e.g. legacy double-encoded Archive.org enclosures) may only be
 * repaired after a fresh identical RSS episode match + live byte probe — never via blind
 * host-canonical URL rewriting alone.
 */
export function shouldAllowHostCanonicalFallback(row: { requires_rss_match?: boolean | null }): boolean {
  return !row.requires_rss_match;
}

/**
 * Mirrors the SQL claim priority order in claim_audio_source_repair_queue_v2:
 *  - Real listener playback errors (pending/deferred, priority >= 100): 100
 *  - Targeted non-human maintenance items (pending/deferred, priority < 100): row.priority (e.g. 40)
 *  - Expired broken_no_alternative rare re-check: 20
 *  - Expired external_only rare re-check: 10
 */
export function effectiveQueuePriority(row: { status: string; priority?: number | null }): number {
  const p = Number(row.priority ?? 100);
  if (row.status === "pending" || row.status === "deferred") return p >= 100 ? 100 : p;
  if (row.status === "broken_no_alternative") return 20;
  if (row.status === "external_only") return 10;
  return 0;
}