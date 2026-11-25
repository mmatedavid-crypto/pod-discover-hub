import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmartPlayerProvider, useSmartPlayer, type SmartPlayerEpisode } from "@/components/smart-player/SmartPlayerProvider";
import { playbackPageUrl } from "@/lib/playerFallback";

const mocks = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/playerEvents", () => ({ logPlayerEvent: mocks.log }));
vi.mock("@/lib/liveTelegramNotify", () => ({ notifyLiveEvent: vi.fn() }));
vi.mock("@/lib/playerProgress", () => ({ getProgress: () => null, saveProgress: vi.fn(), markPlayCount: vi.fn() }));
vi.mock("@/lib/playerPreview", () => ({ isPlayerPreviewActive: () => false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  auth: { getSession: async () => ({ data: { session: null } }) },
} }));

class FakeAudio extends EventTarget {
  src = ""; currentTime = 0; duration = 300; paused = true; ended = false;
  preload = "none"; playbackRate = 1; error: { code: number } | null = null;
  get currentSrc() { return this.src; }
  getAttribute(name: string) { return name === "src" ? this.src : null; }
  play = vi.fn((): Promise<void> => { this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve(); });
  pause = vi.fn(() => { this.paused = true; this.dispatchEvent(new Event("pause")); });
  load = vi.fn(() => { this.error = null; this.currentTime = 0; });
  fail(code: number) { this.error = { code }; this.dispatchEvent(new Event("error")); }
}
let audio: FakeAudio;
let player: ReturnType<typeof useSmartPlayer>;
function Probe() { player = useSmartPlayer(); return null; }
const ep: SmartPlayerEpisode = { id: "a", title: "A", audioUrl: "https://media.example/a.mp3", externalUrl: "https://publisher.example/episode-a" };
const epB: SmartPlayerEpisode = { ...ep, id: "b", title: "B", audioUrl: "https://media.example/b.mp3" };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const errors = () => mocks.log.mock.calls.filter(([e]) => e.eventType === "playback_error");
async function start(episode = ep) { await act(async () => { player.play(episode); await flush(); }); }
function rejectNext() {
  let reject: (error: unknown) => void = () => {};
  audio.play.mockImplementationOnce(() => new Promise<void>((_, r) => { reject = r; }));
  return (name = "NotSupportedError") => reject({ name });
}

beforeEach(() => {
  vi.useFakeTimers(); mocks.log.mockClear();
  vi.stubGlobal("Audio", function () { audio = new FakeAudio(); return audio; });
  render(<SmartPlayerProvider><Probe /></SmartPlayerProvider>);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("actual player attempt recovery", () => {
  it("plays successfully without errors", async () => {
    await start(); expect(player.isPlaying).toBe(true); expect(player.error).toBeNull(); expect(errors()).toHaveLength(0);
  });
  it("logs element plus promise failure only once", async () => {
    const reject = rejectNext(); await start();
    await act(async () => { audio.fail(4); reject(); await flush(); });
    expect(player.error).toBe("Playback error"); expect(player.isPlaying).toBe(false); expect(errors()).toHaveLength(1);
  });
  it("also deduplicates promise-first then element", async () => {
    const reject = rejectNext(); await start();
    await act(async () => { audio.error = { code: 4 }; reject(); await flush(); audio.fail(4); await flush(); });
    expect(errors()).toHaveLength(1);
  });
  it("reloads a deliberate retry, preserves position and can succeed", async () => {
    await start(); await act(async () => { audio.currentTime = 73; audio.fail(4); await flush(); });
    await act(async () => { player.resume(); await flush(); audio.dispatchEvent(new Event("loadedmetadata")); });
    expect(audio.load).toHaveBeenCalledTimes(1); expect(audio.currentTime).toBe(73);
    expect(player.error).toBeNull(); expect(player.isPlaying).toBe(true); expect(errors()).toHaveLength(1);
  });
  it("keeps a separate failure for each deliberate retry", async () => {
    await start(); await act(async () => { audio.fail(4); await flush(); });
    await act(async () => { player.resume(); await flush(); audio.fail(4); await flush(); });
    expect(errors()).toHaveLength(2);
  });
  it("ignores a previous episode's late promise rejection", async () => {
    const reject = rejectNext(); await start(); await start(epB);
    await act(async () => { reject(); await flush(); });
    expect(player.currentEpisode?.id).toBe("b"); expect(player.error).toBeNull(); expect(errors()).toHaveLength(0);
  });
  it("records failures of different episodes independently", async () => {
    await start(); await act(async () => { audio.fail(4); await flush(); });
    await start(epB); await act(async () => { audio.fail(3); await flush(); });
    expect(errors().map(([e]) => e.episodeId)).toEqual(["a", "b"]);
  });
  it("waits for bounded network retry and ignores the original rejected promise", async () => {
    const reject = rejectNext(); await start();
    await act(async () => { audio.currentTime = 42; audio.fail(2); reject("NetworkError"); await flush(); });
    expect(player.error).toBeNull(); expect(player.isLoading).toBe(true); expect(errors()).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(1500); await flush(); audio.dispatchEvent(new Event("loadedmetadata")); });
    expect(audio.play).toHaveBeenCalledTimes(2); expect(audio.currentTime).toBe(42); expect(player.error).toBeNull();
    await act(async () => { audio.fail(2); await flush(); audio.fail(2); await flush(); });
    expect(errors()).toHaveLength(1); expect(errors()[0][0].meta.retried).toBe(true);
  });
  it("reports a retry promise failure even without another element event", async () => {
    await start(); await act(async () => { audio.fail(2); await flush(); });
    audio.play.mockRejectedValueOnce({ name: "NotSupportedError" });
    await act(async () => { vi.advanceTimersByTime(1500); await flush(); });
    expect(errors()).toHaveLength(1); expect(player.error).toBe("Playback error");
  });
  it("does not publish a promise-first network failure before its retry", async () => {
    const reject = rejectNext(); await start();
    await act(async () => { audio.error = { code: 2 }; reject("NetworkError"); await flush(); audio.fail(2); await flush(); });
    expect(errors()).toHaveLength(0); expect(player.error).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1500); await flush(); });
    expect(audio.load).toHaveBeenCalledTimes(1); expect(player.error).toBeNull();
  });
  it("an old queued network retry cannot reload the next episode", async () => {
    await start(); await act(async () => { audio.fail(2); await flush(); });
    await start(epB);
    await act(async () => { vi.advanceTimersByTime(1500); await flush(); });
    expect(audio.src).toBe(epB.audioUrl); expect(audio.load).not.toHaveBeenCalled();
    expect(audio.play).toHaveBeenCalledTimes(2); expect(errors()).toHaveLength(0);
  });
  it("pause or a new episode cancels the queued automatic retry", async () => {
    await start(); await act(async () => { audio.fail(2); player.pause(); vi.advanceTimersByTime(1500); await flush(); });
    expect(audio.play).toHaveBeenCalledTimes(1);
    await start(epB); expect(player.error).toBeNull();
  });
  it("blocked autoplay is separate from a broken source", async () => {
    audio.play.mockRejectedValueOnce({ name: "NotAllowedError" }); await start();
    expect(player.error).toBeNull(); expect(player.isPlaying).toBe(false); expect(errors()).toHaveLength(0);
    expect(mocks.log.mock.calls.filter(([e]) => e.eventType === "playback_blocked")).toHaveLength(1);
  });
  it("ignores an old element's source and a stopped episode", async () => {
    await start();
    Object.defineProperty(audio, "currentSrc", { configurable: true, value: "https://media.example/old.mp3" });
    await act(async () => { audio.fail(4); await flush(); player.stop(); audio.fail(4); await flush(); });
    expect(errors()).toHaveLength(0);
  });
});

describe("distinct safe fallback pages", () => {
  it("rejects failed audio even with fragment/query changes, then chooses the platform page", () => {
    expect(playbackPageUrl({ audio_url: ep.audioUrl, episode_url: ep.audioUrl + "?download=1#x", spotify_url: "https://open.spotify.com/episode/123" })).toBe("https://open.spotify.com/episode/123");
  });
  it("rejects script, credentials, relative URLs and other direct audio", () => {
    for (const externalUrl of ["javascript:alert(1)", "https://user:secret@example.com/page", "/page", "https://other.example/another.mp3"]) {
      expect(playbackPageUrl({ ...ep, externalUrl })).toBeNull();
    }
  });
  it("keeps the distinct original episode page and returns no link when none exists", () => {
    expect(playbackPageUrl(ep)).toBe(ep.externalUrl);
    expect(playbackPageUrl({ audioUrl: ep.audioUrl, externalUrl: ep.audioUrl })).toBeNull();
  });
});