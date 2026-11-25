import { evaluateAudioEligibility } from "./playerAudio";
import { decodeHtmlEntities } from "./text";

/** Only a distinct public page, never the failed stream or a credential-bearing URL. */
export function playbackPageUrl(ep: {
  episode_url?: string | null; externalUrl?: string | null;
  youtube_url?: string | null; spotify_url?: string | null; apple_url?: string | null;
  audio_url?: string | null; audioUrl?: string | null;
}, failedSource?: string | null): string | null {
  const parse = (raw?: string | null) => {
    try {
      const u = new URL(decodeHtmlEntities(raw || "").trim());
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
      u.hash = "";
      return u;
    } catch { return null; }
  };
  const streams = [failedSource, ep.audioUrl, ep.audio_url].map(parse).filter((u) => u !== null);
  for (const raw of [ep.episode_url, ep.externalUrl, ep.youtube_url, ep.spotify_url, ep.apple_url]) {
    const u = parse(raw);
    if (!u || streams.some((s) => s.origin === u.origin && s.pathname === u.pathname)) continue;
    if (evaluateAudioEligibility({ audio_url: u.href }).ok) continue;
    return u.href;
  }
  return null;
}