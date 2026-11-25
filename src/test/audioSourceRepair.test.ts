import { describe, expect, it } from "vitest";
import {
  classifyProbeOutcome,
  collectVerifiedEpisodeAlternatives,
  decideAfterProbe,
  deriveSafeHostCanonicalCandidates,
  hasAudioMagicBytes,
  matchEpisodeInFeedItems,
} from "../../supabase/functions/_shared/audio-source-repair";
import { detectAudioSource, isAudioSourceProvenBroken, playableAudioUrl } from "@/lib/playerAudio";
import { playbackAlternative } from "@/lib/playerFallback";

const enc = (s: string) => new TextEncoder().encode(s);
const pad = (prefix: number[], len = 512) => {
  const out = new Uint8Array(len);
  prefix.forEach((b, i) => { out[i] = b; });
  return out;
};

describe("audio probe verification (magic bytes vs HTML 200 vs server blocks)", () => {
  it("accepts real audio containers (ID3, MPEG frame, M4A ftyp, Ogg, WAV, FLAC)", () => {
    expect(hasAudioMagicBytes(pad([0x49, 0x44, 0x33, 0x03]), "audio/mpeg", "https://cdn.example/a.mp3")).toEqual({ valid: true, format: "mp3_id3" });
    expect(hasAudioMagicBytes(pad([0xff, 0xfb, 0x90, 0x64]), "audio/mpeg", "https://cdn.example/a.mp3")).toEqual({ valid: true, format: "mpeg_frame" });
    expect(hasAudioMagicBytes(pad([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]), "audio/mp4", "https://cdn.example/a.m4a")).toEqual({ valid: true, format: "mp4_m4a" });
    expect(hasAudioMagicBytes(pad([0x4f, 0x67, 0x67, 0x53]), "audio/ogg", "https://cdn.example/a.ogg")).toEqual({ valid: true, format: "ogg" });
    expect(hasAudioMagicBytes(pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]), "audio/wav", "https://cdn.example/a.wav")).toEqual({ valid: true, format: "wav" });
    expect(hasAudioMagicBytes(pad([0x66, 0x4c, 0x61, 0x43]), "audio/flac", "https://cdn.example/a.flac")).toEqual({ valid: true, format: "flac" });
  });

  it("rejects HTML 200 and JSON 200 error pages as definitive_dead", () => {
    const htmlRes = classifyProbeOutcome({
      status: 200,
      contentType: "text/html; charset=utf-8",
      contentLength: 4200,
      bytes: enc("<!DOCTYPE html><html><body>Episode removed</body></html>".repeat(10)),
      finalUrl: "https://www.buzzsprout.com/2602108/episodes/18822658.mp3",
    });
    expect(htmlRes.verdict).toBe("definitive_dead");

    const disguisedHtml = classifyProbeOutcome({
      status: 200,
      contentType: "application/octet-stream",
      contentLength: 2048,
      bytes: enc("  <html><head><title>404</title></head></html>".repeat(8)),
      finalUrl: "https://cdn.example/ep.mp3",
    });
    expect(disguisedHtml.verdict).toBe("definitive_dead");

    const notFound = classifyProbeOutcome({
      status: 404,
      contentType: "text/plain",
      contentLength: 9,
      bytes: enc("Not Found"),
      finalUrl: "https://cdn.example/dead.mp3",
    });
    expect(notFound.verdict).toBe("definitive_dead");
  });

  it("treats 403/429/451/503 as inconclusive so geo-blocks or server blocks never disable working audio", () => {
    for (const status of [403, 429, 451, 500, 502, 503]) {
      const r = classifyProbeOutcome({
        status,
        contentType: "text/plain",
        contentLength: 0,
        bytes: new Uint8Array(0),
        finalUrl: "https://cdn.example/ep.mp3",
      });
      expect(r.verdict).toBe("inconclusive");
    }
  });

  it("respects recent successful playback before disabling any stream", () => {
    expect(decideAfterProbe({ probeVerdict: "inconclusive", recentProgressCount: 1, recentProgressAfterLastError: 1 })).toBe("already_ok");
    expect(decideAfterProbe({ probeVerdict: "definitive_dead", recentProgressCount: 1, recentProgressAfterLastError: 1 })).toBe("already_ok");
    expect(decideAfterProbe({ probeVerdict: "inconclusive", recentProgressCount: 4, recentProgressAfterLastError: 0 })).toBe("already_ok");
    expect(decideAfterProbe({ probeVerdict: "inconclusive", recentProgressCount: 0, recentProgressAfterLastError: 0 })).toBe("defer");
    expect(decideAfterProbe({ probeVerdict: "definitive_dead", recentProgressCount: 0, recentProgressAfterLastError: 0 })).toBe("needs_repair");
  });
});

describe("conservative same-show RSS matching & canonical URL fixes", () => {
  const baseItem = {
    title: "Cystitis diagnosztikája és kezelése",
    guid: "Buzzsprout-12471601",
    link: "https://example.hu/ep1",
    published: "2023-03-20T09:00:00.000Z",
    description: "",
    audio_url: "https://www.buzzsprout.com/1997072/episodes/12471601-cystitis.mp3",
    image: "",
    duration_seconds: 1500,
  };

  it("matches uniquely by exact GUID first", () => {
    const hit = matchEpisodeInFeedItems(
      {
        title: "Old title variant",
        guid: "Buzzsprout-12471601",
        published_at: "2023-03-20T09:00:00Z",
        audio_url: "https://www.buzzsprout.com/1997072/12471601-cystitis.mp3",
      },
      [baseItem],
    );
    expect(hit?.method).toBe("rss_guid");
    expect(hit?.item.audio_url).toBe(baseItem.audio_url);
  });

  it("matches migrated-host episodes uniquely by title + date/duration and rejects ambiguous duplicates", () => {
    const ep = {
      title: "Cystitis diagnosztikája és kezelése",
      guid: "old-host-guid-1",
      published_at: "2023-03-21T09:00:00Z",
      duration_seconds: 1505,
      audio_url: "https://old.example/dead.mp3",
    };
    const hit = matchEpisodeInFeedItems(ep, [{ ...baseItem, guid: "new-anchor-guid-9" }]);
    expect(hit?.method).toBe("rss_title_date_duration");

    const ambig = matchEpisodeInFeedItems(ep, [
      { ...baseItem, guid: "new-1", audio_url: "https://new.example/1.mp3" },
      { ...baseItem, guid: "new-2", audio_url: "https://new.example/2.mp3" },
    ]);
    expect(ambig).toBeNull();
  });

  it("derives conservative same-host canonical fixes for double-encoding and legacy Buzzsprout paths", () => {
    expect(
      deriveSafeHostCanonicalCandidates("https://archive.org/download/ahm/Schindler%2520list%C3%A1ja.mp3"),
    ).toEqual([
      { url: "https://archive.org/download/ahm/Schindler%20list%C3%A1ja.mp3", method: "same_host_double_encoding_fix" },
    ]);

    expect(
      deriveSafeHostCanonicalCandidates("https://www.buzzsprout.com/1997072/12471601-cystitis.mp3"),
    ).toEqual([
      { url: "https://www.buzzsprout.com/1997072/episodes/12471601-cystitis.mp3", method: "buzzsprout_episodes_path" },
    ]);
  });
});

describe("verified episode-level external alternatives & player gating", () => {
  it("collects only episode-level platform URLs, rejecting show-level pages and audio files", () => {
    const alts = collectVerifiedEpisodeAlternatives({
      audio_url: "https://www.buzzsprout.com/2602108/episodes/18822658.mp3",
      spotify_url: "https://open.spotify.com/show/5IY0FzFDwVOMVhqgvEDJGx",
      best_spotify_meta_url: "https://open.spotify.com/episode/4sLOJpKFF5tc8NXUoArVfT",
      best_spotify_meta_confidence: 1,
      apple_url: "https://podcasts.apple.com/hu/podcast/show/id1884593133",
      episode_url: "https://www.buzzsprout.com/2602108/episodes/18822658.mp3",
    });
    expect(alts).toEqual([
      {
        field: "spotify_url",
        url: "https://open.spotify.com/episode/4sLOJpKFF5tc8NXUoArVfT",
        source: "episode_spotify_meta",
        needsHttpCheck: false,
      },
    ]);
  });

  it("immediately suppresses dead internal playback and surfaces Spotify on Krizsó external_only episode, while respecting manual keep_internal", () => {
    const krizso = {
      audio_url: "https://www.buzzsprout.com/2602108/episodes/18822658-hazudsz-amikor-azt-mondod-jol-vagyok-az-onbecsules-csapdai.mp3",
      audio_health_status: "external_only",
      spotify_url: "https://open.spotify.com/episode/4sLOJpKFF5tc8NXUoArVfT",
    };
    expect(isAudioSourceProvenBroken(krizso)).toBe(true);
    expect(playableAudioUrl(krizso)).toBeNull();
    expect(detectAudioSource(krizso)).toBeNull();
    expect(playbackAlternative(krizso)).toEqual({
      href: "https://open.spotify.com/episode/4sLOJpKFF5tc8NXUoArVfT",
      platform: "spotify",
      label: "Hallgatás Spotify-on",
    });

    expect(playableAudioUrl({ ...krizso, audio_manual_override: "keep_internal" })).toBe(krizso.audio_url);
    expect(playableAudioUrl({ ...krizso, audio_health_status: "repaired" })).toBe(krizso.audio_url);
    expect(playableAudioUrl({ ...krizso, audio_health_status: "unknown" })).toBe(krizso.audio_url);
  });
});