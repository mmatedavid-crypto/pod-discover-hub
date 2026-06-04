// Detect whether an episode has a usable in-browser audio source.
import { decodeHtmlEntities } from "@/lib/text";

const BAD_HOST_SUFFIXES = [
  "open.spotify.com", "spotify.com",
  "podcasts.apple.com", "music.apple.com",
  "youtube.com", "youtu.be",
  "soundcloud.com", "iheart.com", "stitcher.com",
  "castbox.fm", "overcast.fm",
];

const DIRECT_AUDIO_HOST_SUFFIXES = [
  "traffic.omny.fm", "traffic.libsyn.com", "traffic.megaphone.fm",
  "dts.podtrac.com", "chrt.fm", "pdst.fm", "mcdn.podbean.com",
  "anchor.fm/s", "stitcher.simplecastaudio.com",
  "media.transistor.fm", "audio.transistor.fm",
  "rss.art19.com", "cdn.simplecast.com", "pdcn.co", "play.podtrac.com",
];

const AUDIO_EXT = /\.(mp3|m4a|mp4|aac|wav|ogg|oga|opus|webm|m3u8)(\?|#|$)/i;

export type AudioSource = { url: string; likelyDirect: boolean };

export type AudioRejectReason =
  | "missing_audio_url" | "invalid_url" | "non_http"
  | "non_direct_audio_url" | "unsupported_mime";

export type EligibilityResult =
  | { ok: true; source: AudioSource }
  | { ok: false; reason: AudioRejectReason };

function hostMatches(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((suf) => h === suf || h.endsWith("." + suf) || h.endsWith(suf));
}

export function evaluateAudioEligibility(
  ep: { audio_url?: string | null; episode_url?: string | null } | null | undefined,
): EligibilityResult {
  if (!ep) return { ok: false, reason: "missing_audio_url" };
  const raw0 = (ep.audio_url || "").trim();
  if (!raw0) return { ok: false, reason: "missing_audio_url" };
  const raw = decodeHtmlEntities(raw0).trim();
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: "invalid_url" }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: "non_http" };
  const extHit = AUDIO_EXT.test(u.pathname) || AUDIO_EXT.test(raw);
  // A real audio extension on the path means it's a direct stream even if
  // the host (e.g. feeds.soundcloud.com) is part of a platform domain.
  if (!extHit && hostMatches(u.hostname, BAD_HOST_SUFFIXES)) {
    return { ok: false, reason: "non_direct_audio_url" };
  }
  const directHost = hostMatches(u.hostname, DIRECT_AUDIO_HOST_SUFFIXES);
  if (!extHit && !directHost) {
    return { ok: false, reason: "non_direct_audio_url" };
  }
  return { ok: true, source: { url: raw, likelyDirect: extHit || directHost } };
}

export function detectAudioSource(
  ep: { audio_url?: string | null; episode_url?: string | null } | null | undefined,
): AudioSource | null {
  const r = evaluateAudioEligibility(ep);
  return r.ok ? r.source : null;
}
