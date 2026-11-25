import { evaluateAudioEligibility } from "./playerAudio";
import { decodeHtmlEntities } from "./text";

export type PlaybackAlternative = {
  href: string;
  platform: "spotify" | "apple" | "youtube" | "original_page";
  label: string;
};

type FallbackEpisodeInput = {
  episode_url?: string | null; externalUrl?: string | null;
  youtube_url?: string | null; spotify_url?: string | null; apple_url?: string | null;
  audio_url?: string | null; audioUrl?: string | null;
  audio_health_status?: string | null; audio_manual_override?: string | null;
};

function parseSafeHttp(raw?: string | null): URL | null {
  try {
    const u = new URL(decodeHtmlEntities(raw || "").trim());
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    u.hash = "";
    return u;
  } catch { return null; }
}

function classifyPlatform(u: URL): Pick<PlaybackAlternative, "platform" | "label"> {
  const h = u.hostname.toLowerCase();
  if (h === "open.spotify.com" || h.endsWith(".spotify.com")) {
    return { platform: "spotify", label: "Hallgatás Spotify-on" };
  }
  if (h.endsWith("podcasts.apple.com") || h.endsWith("music.apple.com")) {
    return { platform: "apple", label: "Hallgatás Apple Podcasts-ban" };
  }
  if (h === "youtu.be" || h === "youtube.com" || h.endsWith(".youtube.com")) {
    return { platform: "youtube", label: "Megnyitás YouTube-on" };
  }
  return { platform: "original_page", label: "Megnyitás az eredeti oldalon" };
}

/** Only a distinct public page, never the failed stream or a credential-bearing URL. */
export function playbackAlternative(ep: FallbackEpisodeInput, failedSource?: string | null): PlaybackAlternative | null {
  const streams = [failedSource, ep.audioUrl, ep.audio_url].map(parseSafeHttp).filter((u): u is URL => u !== null);
  // When audio is proven broken (external_only), prefer verified platform episode URLs before generic episode_url
  const ordered = ep.audio_health_status === "external_only" || ep.audio_manual_override === "external_only"
    ? [ep.spotify_url, ep.youtube_url, ep.apple_url, ep.episode_url, ep.externalUrl]
    : [ep.episode_url, ep.externalUrl, ep.youtube_url, ep.spotify_url, ep.apple_url];
  for (const raw of ordered) {
    const u = parseSafeHttp(raw);
    if (!u || streams.some((s) => s.origin === u.origin && s.pathname === u.pathname)) continue;
    if (evaluateAudioEligibility({ audio_url: u.href }).ok) continue;
    return { href: u.href, ...classifyPlatform(u) };
  }
  return null;
}

/** Only a distinct public page, never the failed stream or a credential-bearing URL. */
export function playbackPageUrl(ep: FallbackEpisodeInput, failedSource?: string | null): string | null {
  return playbackAlternative(ep, failedSource)?.href ?? null;
}