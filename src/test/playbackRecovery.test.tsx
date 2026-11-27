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
const playings = () => mocks.log.mock.calls.filter(([e]) => e.eventType === "play_playing");
async function start(episode = ep) { await act(async () => { player.play(episode); await flush(); }); }
function rejectNext() {
  let reject: (error: unknown) => void = () => {};
  audio.play.mockImplementationOnce(() => new Promise<void>((_, r) => { reject = r; }));
  return (name = "NotSupportedError") => reject({ name });
}

beforeEach(() => {
  vi.useFakeTimers(); mocks.log.mockClear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
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
  it("keeps a shared timestamp (?t=) seek when autoplay is blocked and the user taps Play", async () => {
    audio.play.mockRejectedValueOnce({ name: "NotAllowedError" });
    await act(async () => { player.play(ep, { startAt: 125 }); await flush(); });
    expect(player.isPlaying).toBe(false); expect(player.error).toBeNull(); expect(audio.currentTime).toBe(0);
    await act(async () => { player.toggle(); await flush(); audio.dispatchEvent(new Event("loadedmetadata")); });
    expect(player.isPlaying).toBe(true); expect(audio.currentTime).toBe(125);
  });
  it("replaces a pending seek when another timestamp is requested before metadata loads", async () => {
    audio.play.mockRejectedValueOnce({ name: "NotAllowedError" });
    await act(async () => { player.play(ep, { startAt: 125 }); await flush(); });
    await act(async () => { player.play(ep, { startAt: 240 }); await flush(); audio.dispatchEvent(new Event("loadedmetadata")); });
    expect(audio.currentTime).toBe(240);
  });
  it("does not apply a previous episode's pending seek after switching or stopping", async () => {
    audio.play.mockRejectedValueOnce({ name: "NotAllowedError" });
    await act(async () => { player.play(ep, { startAt: 125 }); await flush(); });
    await start(epB);
    await act(async () => { audio.dispatchEvent(new Event("loadedmetadata")); });
    expect(audio.currentTime).toBe(0);
    audio.play.mockRejectedValueOnce({ name: "NotAllowedError" });
    await act(async () => { player.play(ep, { startAt: 125 }); await flush(); });
    await act(async () => { player.stop(); await flush(); });
    await start(ep);
    await act(async () => { audio.dispatchEvent(new Event("loadedmetadata")); });
    expect(audio.currentTime).toBe(0);
  });
  it("preserves a shared timestamp across a failure before metadata loads and deliberate retry", async () => {
    audio.play.mockRejectedValueOnce({ name: "NotAllowedError" });
    await act(async () => { player.play(ep, { startAt: 125 }); await flush(); });
    await act(async () => { audio.fail(4); await flush(); });
    await act(async () => { player.resume(); await flush(); audio.dispatchEvent(new Event("loadedmetadata")); });
    expect(audio.load).toHaveBeenCalledTimes(1); expect(audio.currentTime).toBe(125); expect(player.isPlaying).toBe(true);
  });
});

describe("scoped native playing confirmation for active show trial & fixed controls", () => {
  const pilotEp: SmartPlayerEpisode = {
    id: "pilot-ep-1",
    title: "Pilot ep",
    podcastId: "2f564d96-279a-49b5-a4c1-21796fec2b73",
    podcastSlug: "friderikusz-podcast",
    audioUrl: "https://media.example/pilot-1.mp3",
  };
  const pilotEp2: SmartPlayerEpisode = {
    ...pilotEp,
    id: "pilot-ep-2",
    audioUrl: "https://media.example/pilot-2.mp3",
  };
  const controlEp: SmartPlayerEpisode = {
    id: "ctrl-ep-1",
    title: "Control ep",
    podcastId: "973593cf-c16d-4d0d-a7a8-d2cf66f113f3",
    podcastSlug: "kettes-szamrendszer",
    audioUrl: "https://media.example/ctrl-1.mp3",
  };
  const otherEp: SmartPlayerEpisode = {
    id: "other-ep-1",
    title: "Other ep",
    podcastId: "a5092c31-5eea-402b-8697-1e12991efc85",
    podcastSlug: "gombapresszo-1",
    audioUrl: "https://media.example/other-1.mp3",
  };

  it("never logs play_playing on click alone or autoplay failure, and logs once per loaded episode on native playing without doubles on buffer/resume", async () => {
    window.history.replaceState({}, "", "/podcast/friderikusz-podcast");
    sessionStorage.setItem("pv_landing_path", "/podcast/friderikusz-podcast");

    // Autoplay blocked -> zero play_playing
    audio.play.mockRejectedValueOnce({ name: "NotAllowedError" });
    await start(pilotEp);
    expect(playings()).toHaveLength(0);

    // Click / play() resolves, but native "playing" hasn't fired yet -> still zero play_playing
    await act(async () => { player.toggle(); await flush(); });
    expect(playings()).toHaveLength(0);

    // Native "playing" fires -> logs exactly once with pilot cohort metadata
    await act(async () => { audio.dispatchEvent(new Event("playing")); await flush(); });
    expect(playings()).toHaveLength(1);
    expect(playings()[0][0]).toMatchObject({
      eventType: "play_playing",
      episodeId: "pilot-ep-1",
      podcastId: pilotEp.podcastId,
      meta: {
        cohort: "pilot",
        show_slug: "friderikusz-podcast",
        landing_path: "/podcast/friderikusz-podcast",
        current_path: "/podcast/friderikusz-podcast",
        direct_show_landing: true,
        trigger: "native_playing",
      },
    });

    // Buffering stall (waiting -> playing) and user pause -> resume -> playing MUST NOT double-log
    await act(async () => {
      audio.dispatchEvent(new Event("waiting"));
      audio.dispatchEvent(new Event("playing"));
      player.pause();
      player.resume();
      audio.dispatchEvent(new Event("playing"));
      await flush();
    });
    expect(playings()).toHaveLength(1);

    // Loading a new episode DOES log a fresh play_playing once native playing fires
    await start(pilotEp2);
    await act(async () => { audio.dispatchEvent(new Event("playing")); await flush(); });
    expect(playings()).toHaveLength(2);
    expect(playings()[1][0].episodeId).toBe("pilot-ep-2");
  });

  it("logs play_playing for fixed control show landings and ignores non-cohort shows", async () => {
    window.history.replaceState({}, "", "/podcast/kettes-szamrendszer");
    sessionStorage.setItem("pv_landing_path", "/podcast/kettes-szamrendszer");
    await start(controlEp);
    await act(async () => { audio.dispatchEvent(new Event("playing")); await flush(); });
    expect(playings()).toHaveLength(1);
    expect(playings()[0][0].meta).toMatchObject({
      cohort: "control",
      show_slug: "kettes-szamrendszer",
      direct_show_landing: true,
    });

    // Unrelated show landing gets zero play_playing events
    mocks.log.mockClear();
    sessionStorage.setItem("pv_landing_path", "/podcast/gombapresszo-1");
    window.history.replaceState({}, "", "/podcast/gombapresszo-1");
    await start(otherEp);
    await act(async () => { audio.dispatchEvent(new Event("playing")); await flush(); });
    expect(playings()).toHaveLength(0);
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