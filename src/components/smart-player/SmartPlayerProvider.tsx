import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isPlayerPreviewActive } from "@/lib/playerPreview";
import { detectAudioSource } from "@/lib/playerAudio";
import { getProgress, saveProgress, markPlayCount } from "@/lib/playerProgress";
import { SMART_PLAYER_RECOMMENDATIONS_ENABLED } from "./recommendationsConfig";

export type SmartPlayerEpisode = {
  id: string;
  title: string;
  podcastId?: string | null;
  podcastTitle?: string | null;
  podcastSlug?: string | null;
  episodeSlug?: string | null;
  imageUrl?: string | null;
  audioUrl: string;
  externalUrl?: string | null;
};

type FlagShape = {
  enabled: boolean;
  dev_preview_enabled: boolean;
  show_on_public_episode_pages: boolean;
  show_taste_buttons: boolean;
  show_semantic_queue: boolean;
};

const DEFAULT_FLAGS: FlagShape = {
  enabled: false,
  dev_preview_enabled: true,
  show_on_public_episode_pages: false,
  show_taste_buttons: false,
  show_semantic_queue: false,
};

export type AutoplayMode = "related" | "series";

type Ctx = {
  flags: FlagShape;
  previewActive: boolean;
  playerVisible: boolean;
  currentEpisode: SmartPlayerEpisode | null;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  currentTime: number;
  duration: number;
  playbackRate: number;
  expanded: boolean;
  autoplayMode: AutoplayMode;
  setAutoplayMode: (m: AutoplayMode) => void;
  setExpanded: (v: boolean) => void;
  play: (ep: SmartPlayerEpisode, opts?: { resume?: boolean; startAt?: number }) => void;
  toggle: () => void;
  pause: () => void;
  resume: () => void;
  seekTo: (sec: number) => void;
  seekBy: (delta: number) => void;
  setPlaybackRate: (r: number) => void;
  stop: () => void;
};

const SmartPlayerCtx = createContext<Ctx | null>(null);

const PROGRESS_MARKERS = [
  { pct: 0.25, type: "play_25" as const },
  { pct: 0.5, type: "play_50" as const },
  { pct: 0.75, type: "play_75" as const },
];

type PlayerEventPayload = {
  eventType:
    | "play_start" | "play_pause" | "play_resume" | "play_seek"
    | "play_25" | "play_50" | "play_75" | "play_complete"
    | "playback_error" | "playback_blocked" | "external_open" | "speed_change";
  episodeId?: string | null;
  podcastId?: string | null;
  positionSec?: number;
  durationSec?: number;
  playbackRate?: number;
  meta?: Record<string, unknown>;
};

/** Low-cardinality error context: MediaError code/name and the audio host only (never the URL). */
export function mediaErrorMeta(code: number | null, src: string | null | undefined, retried: boolean) {
  const names: Record<number, string> = { 1: "aborted", 2: "network", 3: "decode", 4: "src_not_supported" };
  let host: string | null = null;
  try { host = src ? new URL(src).hostname.slice(0, 80) : null; } catch { host = null; }
  return { code, kind: code ? names[code] ?? "unknown" : "unknown", host, retried };
}

/** play() promise rejection → what it means for the listener. */
export function classifyPlayRejection(err: unknown): "superseded" | "blocked" | "unsupported" | "failed" {
  const name = (err as { name?: string } | null)?.name || "";
  if (name === "AbortError") return "superseded"; // a newer load() replaced this play request
  if (name === "NotAllowedError") return "blocked"; // autoplay policy: needs a tap, source is fine
  if (name === "NotSupportedError") return "unsupported";
  return "failed";
}

/** Seeks closer than this are one scrub gesture: log it once with its start and end. */
export const SEEK_LOG_DEBOUNCE_MS = 800;

function logPlayerEventLater(opts: PlayerEventPayload) {
  void import("@/lib/playerEvents")
    .then(({ logPlayerEvent }) => logPlayerEvent(opts))
    .catch(() => { /* fail-safe */ });
}

function notifyLiveEventLater(kind: "search_submit" | "swipe_complete" | "play_start", payload: Record<string, unknown>) {
  void import("@/lib/liveTelegramNotify")
    .then(({ notifyLiveEvent }) => notifyLiveEvent(kind, payload))
    .catch(() => { /* fail-safe */ });
}

export function SmartPlayerProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<FlagShape>(DEFAULT_FLAGS);
  const [previewActive, setPreviewActive] = useState(false);
  const [currentEpisode, setCurrentEpisode] = useState<SmartPlayerEpisode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setRateState] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [autoplayMode, setAutoplayModeState] = useState<AutoplayMode>(() => {
    if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return "series";
    try {
      const v = typeof window !== "undefined" ? localStorage.getItem("podiverzum_autoplay_mode") : null;
      return v === "series" ? "series" : "related";
    } catch { return "related"; }
  });
  const setAutoplayMode = useCallback((m: AutoplayMode) => {
    const next = !SMART_PLAYER_RECOMMENDATIONS_ENABLED && m === "related" ? "series" : m;
    setAutoplayModeState(next);
    try { localStorage.setItem("podiverzum_autoplay_mode", next); } catch { /* noop */ }
  }, []);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const markedRef = useRef<Set<string>>(new Set());
  const playedRef = useRef<{ id: string | null; sec: number; last: number }>({ id: null, sec: 0, last: 0 });
  const currentEpisodeRef = useRef<SmartPlayerEpisode | null>(null);
  const autoplayNextRef = useRef<((ep: SmartPlayerEpisode) => void) | null>(null);
  const autoplayHistoryRef = useRef<Set<string>>(new Set());
  // Crowdsourced duration backfill: session-level dedup.
  const reportedDurationRef = useRef<Set<string>>(new Set());
  // Tracks whether the most recent pause came from a user action (button,
  // mediaSession, stop) vs. an OS-level interruption (incoming call, route
  // change, headphones unplug, app backgrounded by another media app).
  // When an interruption pauses us, we try to auto-resume as soon as the
  // tab regains focus / visibility / network — Netflix-style "pick up where
  // you left off" after a phone call.
  const userPausedRef = useRef(false);
  const interruptedRef = useRef(false);
  // Load generation: async results (play promise, metadata seek, autoplay lookup) from an
  // older episode must not touch the current one.
  const loadGenRef = useRef(0);
  const retriedRef = useRef<Set<string>>(new Set());
  const failedGenRef = useRef<number | null>(null);
  const retryPendingRef = useRef(false);
  const playRequestRef = useRef(0);
  const retryPositionRef = useRef(0);
  const resumeAttemptsRef = useRef(0);
  const pendingSeekRef = useRef<(() => void) | null>(null);
  const seekLogRef = useRef<{ timer: number | null; from: number; epId: string | null }>({ timer: null, from: 0, epId: null });

  const queueSeekLog = (ep: SmartPlayerEpisode, from: number, to: number) => {
    const st = seekLogRef.current;
    if (st.timer != null && st.epId === ep.id) {
      window.clearTimeout(st.timer);
    } else {
      st.from = from;
      st.epId = ep.id;
    }
    st.timer = window.setTimeout(() => {
      st.timer = null;
      logPlayerEventLater({
        eventType: "play_seek",
        episodeId: ep.id,
        podcastId: ep.podcastId,
        positionSec: audioRef.current?.currentTime ?? to,
        meta: { from_sec: Math.floor(st.from) },
      });
    }, SEEK_LOG_DEBOUNCE_MS);
  };

  const restorePosition = (a: HTMLAudioElement, pos: number, gen: number) => {
    if (pendingSeekRef.current) a.removeEventListener("loadedmetadata", pendingSeekRef.current);
    const onReady = () => {
      a.removeEventListener("loadedmetadata", onReady);
      if (pendingSeekRef.current === onReady) pendingSeekRef.current = null;
      if (loadGenRef.current !== gen) return;
      try { a.currentTime = Math.max(0, pos); } catch { /* noop */ }
    };
    pendingSeekRef.current = onReady;
    a.addEventListener("loadedmetadata", onReady);
  };

  const reportFailure = (ep: SmartPlayerEpisode, gen: number, phase: string, rejection?: string) => {
    if (loadGenRef.current !== gen || failedGenRef.current === gen || retryPendingRef.current) return;
    const a = audioRef.current;
    if (!a) return;
    const code = a.error?.code ?? null;
    retryPositionRef.current = a.currentTime || retryPositionRef.current;
    if (code === 2 && !retriedRef.current.has(ep.id)) {
      retriedRef.current.add(ep.id);
      retryPendingRef.current = true;
      ++playRequestRef.current; // invalidate the promise paired with this element error
      setIsLoading(true);
      window.setTimeout(() => {
        if (loadGenRef.current !== gen || userPausedRef.current) return;
        retryPendingRef.current = false;
        restorePosition(a, retryPositionRef.current, gen);
        a.load();
        const request = ++playRequestRef.current;
        void a.play().catch((err: unknown) => handlePlayRejection(err, ep, gen, request));
      }, 1500);
      return;
    }
    failedGenRef.current = gen;
    interruptedRef.current = false;
    setError("Playback error");
    setIsPlaying(false);
    setIsLoading(false);
    logPlayerEventLater({
      eventType: "playback_error", episodeId: ep.id, podcastId: ep.podcastId,
      positionSec: retryPositionRef.current,
      meta: { phase, rejection, ...mediaErrorMeta(code, a.currentSrc || ep.audioUrl, retriedRef.current.has(ep.id)) },
    });
  };

  const handlePlayRejection = (err: unknown, ep: SmartPlayerEpisode, gen: number, request: number) => {
    if (loadGenRef.current !== gen || playRequestRef.current !== request || retryPendingRef.current || failedGenRef.current === gen) return;
    const kind = classifyPlayRejection(err);
    if (kind === "superseded") return;
    setIsLoading(false);
    if (kind === "blocked") {
      // Not a broken source: show the play button again, no error fallback.
      interruptedRef.current = false;
      setIsPlaying(false);
      logPlayerEventLater({ eventType: "playback_blocked", episodeId: ep.id, podcastId: ep.podcastId, meta: { reason: "not_allowed" } });
      return;
    }
    reportFailure(ep, gen, "play_promise", kind);
  };

  useEffect(() => {
    setPreviewActive(isPlayerPreviewActive());
    (async () => {
      const { data } = await supabase
        .from("app_settings").select("value").eq("key", "smart_player").maybeSingle();
      if (data?.value && typeof data.value === "object") {
        setFlags({ ...DEFAULT_FLAGS, ...(data.value as Partial<FlagShape>) });
      }
    })();
  }, []);

  useEffect(() => {
    if (audioRef.current) return;
    const a = new Audio();
    a.preload = "none";
    audioRef.current = a;

    const onTime = () => setCurrentTime(a.currentTime);
    const onDur = () => {
      const d = a.duration || 0;
      setDuration(d);
      // Crowdsourced backfill: ha az aktuális epizódhoz nincs ismert hossz,
      // a böngésző által felfedezett értéket elküldjük (session-szintű dedup).
      try {
        const ep = currentEpisodeRef.current;
        if (ep && Number.isFinite(d) && d >= 10 && d <= 43200) {
          if (!reportedDurationRef.current.has(ep.id)) {
            reportedDurationRef.current.add(ep.id);
            void fetch(
              `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/report-episode-duration`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                },
                body: JSON.stringify({ episode_id: ep.id, duration_seconds: Math.round(d) }),
                keepalive: true,
              },
            ).catch(() => {});
          }
        }
      } catch {}
    };
    const onPlay = () => {
      setIsPlaying(true);
      interruptedRef.current = false;
      userPausedRef.current = false;
    };
    const onPause = () => {
      setIsPlaying(false);
      // If we're paused but not at end and the user didn't ask for it,
      // assume an OS interruption (incoming call etc.) and remember so we
      // can auto-resume when the page becomes active again.
      const a2 = audioRef.current;
      if (a2 && !a2.ended && !userPausedRef.current) {
        interruptedRef.current = true;
      }
    };
    const onWait = () => setIsLoading(true);
    const onCanPlay = () => setIsLoading(false);
    const onError = () => {
      const ep = currentEpisodeRef.current;
      // An element with no source (stop/reset) also fires "error": not a playback failure.
      if (!ep || !a.getAttribute("src") || !a.error) return;
      if (a.currentSrc && a.currentSrc !== a.src) return;
      reportFailure(ep, loadGenRef.current, "element");
    };
    const onEnded = () => {
      setIsPlaying(false);
      const ep = currentEpisodeRef.current;
      if (ep) {
        saveProgress(ep.id, a.currentTime, a.duration, true);
        logPlayerEventLater({
          eventType: "play_complete",
          episodeId: ep.id,
          podcastId: ep.podcastId,
          positionSec: a.currentTime,
          durationSec: a.duration,
        });
        autoplayNextRef.current?.(ep);
      }
    };

    a.addEventListener("timeupdate", onTime);
    a.addEventListener("durationchange", onDur);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("waiting", onWait);
    a.addEventListener("canplay", onCanPlay);
    a.addEventListener("error", onError);
    a.addEventListener("ended", onEnded);

    return () => {
      a.pause();
      audioRef.current = null;
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("durationchange", onDur);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("waiting", onWait);
      a.removeEventListener("canplay", onCanPlay);
      a.removeEventListener("error", onError);
      a.removeEventListener("ended", onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-resume after OS-level interruptions (incoming phone call, another
  // app grabbing audio focus, headphones disconnect that auto-paused etc.).
  // When the tab/app becomes active again, if we were interrupted mid-episode
  // we kick playback back on automatically.
  useEffect(() => {
    const tryResume = () => {
      const a = audioRef.current;
      if (!a) return;
      if (failedGenRef.current === loadGenRef.current || retryPendingRef.current) return;
      if (!interruptedRef.current) return;
      if (!currentEpisodeRef.current) return;
      if (!a.paused || a.ended) return;
      if (resumeAttemptsRef.current >= 3) { interruptedRef.current = false; return; }
      resumeAttemptsRef.current += 1;
      void a.play().then(() => {
        interruptedRef.current = false;
        resumeAttemptsRef.current = 0;
      }).catch(() => {
        // Browser blocked autoplay — the next focus/visibility event may retry,
        // at most 3 times per interruption (then the listener taps play).
      });
    };
    const onVisibility = () => { if (document.visibilityState === "visible") tryResume(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", tryResume);
    window.addEventListener("online", tryResume);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", tryResume);
      window.removeEventListener("online", tryResume);
    };
  }, []);

  useEffect(() => {
    if (!currentEpisode || !duration) return;
    const id = currentEpisode.id;
    if (currentTime > 0 && Math.floor(currentTime) % 10 === 0) {
      saveProgress(id, currentTime, duration);
      // Sync to server for logged-in users (fire-and-forget).
      void (async () => {
        try {
          const { data: sess } = await supabase.auth.getSession();
          const uid = sess.session?.user?.id;
          if (!uid) return;
          await supabase.from("playback_progress").upsert(
            {
              user_id: uid,
              episode_id: id,
              position_seconds: Math.floor(currentTime),
              duration_seconds: Math.floor(duration) || null,
              completed: duration > 0 && currentTime / duration > 0.95,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,episode_id" },
          );
        } catch { /* noop */ }
      })();
    }
    // Milestones measure ACTUALLY PLAYED time, not playhead position: a seek
    // (key moment, Q&A "listen from") must not count as listened duration.
    if (playedRef.current.id !== id) playedRef.current = { id, sec: 0, last: currentTime };
    const delta = currentTime - playedRef.current.last;
    if (delta > 0 && delta <= 3) playedRef.current.sec += delta;
    playedRef.current.last = currentTime;
    const playedSec = playedRef.current.sec;
    PROGRESS_MARKERS.forEach((m) => {
      const key = `${id}:${m.type}`;
      if (playedSec / duration >= m.pct && !markedRef.current.has(key)) {
        markedRef.current.add(key);
        logPlayerEventLater({
          eventType: m.type,
          episodeId: id,
          podcastId: currentEpisode.podcastId,
          positionSec: currentTime,
          durationSec: duration,
        });
      }
    });
    // Absolute-time 30s marker → taste signal (independent of episode length).
    const key30 = `${id}:taste_30s`;
    if (currentTime >= 30 && !markedRef.current.has(key30)) {
      markedRef.current.add(key30);
      void import("@/lib/tasteInteractions").then(({ recordTasteInteraction }) =>
        recordTasteInteraction(id, "play_30s", "player"),
      );
    }
  }, [currentTime, duration, currentEpisode]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentEpisode) return;
    try {
      const artwork: MediaImage[] = currentEpisode.imageUrl
        ? [{ src: currentEpisode.imageUrl, sizes: "512x512", type: "image/jpeg" }]
        : [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentEpisode.title,
        artist: currentEpisode.podcastTitle || "Podiverzum",
        album: "Podiverzum",
        artwork,
      });
      navigator.mediaSession.setActionHandler("play", () => {
        userPausedRef.current = false;
        if (failedGenRef.current === loadGenRef.current || retryPendingRef.current) {
          const ep = currentEpisodeRef.current;
          if (ep) playLatestRef.current(ep);
          return;
        }
        void audioRef.current?.play().catch(() => { /* lock-screen play refused: user can tap again */ });
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        // A lock-screen pause is the user's choice, not an interruption to auto-resume.
        userPausedRef.current = true;
        interruptedRef.current = false;
        audioRef.current?.pause();
      });
      navigator.mediaSession.setActionHandler("seekbackward", () => {
        if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15);
      });
      navigator.mediaSession.setActionHandler("seekforward", () => {
        if (audioRef.current) audioRef.current.currentTime = audioRef.current.currentTime + 30;
      });
    } catch { /* noop */ }
  }, [currentEpisode]);

  const play = useCallback((ep: SmartPlayerEpisode, opts?: { resume?: boolean; startAt?: number }) => {
    const a = audioRef.current;
    if (!a) return;
    const same = currentEpisodeRef.current?.id === ep.id;
    const reload = same && (failedGenRef.current === loadGenRef.current || retryPendingRef.current);
    const savedPosition = a.currentTime || retryPositionRef.current;
    setError(null);
    const startAt = typeof opts?.startAt === "number" && Number.isFinite(opts.startAt) && opts.startAt >= 0
      ? opts.startAt
      : null;
    const gen = ++loadGenRef.current;
    failedGenRef.current = null;
    retryPendingRef.current = false;
    retriedRef.current.clear();
    retryPositionRef.current = same ? savedPosition : 0;
    userPausedRef.current = false;
    interruptedRef.current = false;
    if (!same || reload) {
      setCurrentEpisode(ep);
      // Keep non-React handlers on the new episode immediately (not after the next render).
      currentEpisodeRef.current = ep;
      if (!same) {
        setCurrentTime(0);
        setDuration(0);
        markedRef.current = new Set();
      }
      userPausedRef.current = false;
      resumeAttemptsRef.current = 0;
      if (pendingSeekRef.current) {
        a.removeEventListener("loadedmetadata", pendingSeekRef.current);
        pendingSeekRef.current = null;
      }
      a.src = ep.audioUrl;
      const prog = getProgress(ep.id);
      const target = startAt != null
        ? startAt
        : (reload ? savedPosition : opts?.resume && prog && prog.currentTime > 30 && !prog.completed ? prog.currentTime : null);
      if (target != null) {
        // Wait for metadata so currentTime sticks reliably (Safari ignores earlier seeks);
        // a later episode switch removes this listener so it cannot seek the wrong episode.
        const onReady = () => {
          a.removeEventListener("loadedmetadata", onReady);
          if (pendingSeekRef.current === onReady) pendingSeekRef.current = null;
          if (loadGenRef.current !== gen) return;
          try { a.currentTime = Math.max(0, target); } catch { /* noop */ }
        };
        pendingSeekRef.current = onReady;
        a.addEventListener("loadedmetadata", onReady);
      }
      if (reload) a.load();
      markPlayCount(ep.id);
      logPlayerEventLater({
        eventType: "play_start",
        episodeId: ep.id,
        podcastId: ep.podcastId,
        positionSec: a.currentTime,
      });
      notifyLiveEventLater("play_start", {
        episode_id: ep.id,
        episode_title: ep.title,
        podcast_title: ep.podcastTitle,
        episode_url: typeof window !== "undefined" ? window.location.href : undefined,
      });
    } else if (startAt != null) {
      const from = a.currentTime;
      try { a.currentTime = Math.max(0, startAt); } catch { /* noop */ }
      queueSeekLog(ep, from, a.currentTime);
    } else {
      logPlayerEventLater({
        eventType: "play_resume",
        episodeId: ep.id,
        podcastId: ep.podcastId,
        positionSec: a.currentTime,
      });
    }
    setIsLoading(true);
    const request = ++playRequestRef.current;
    void a.play().catch((err: unknown) => handlePlayRejection(err, ep, gen, request));
  }, [currentEpisode]);

  const playLatestRef = useRef(play);
  playLatestRef.current = play;
  const playRef = useCallback((ep: SmartPlayerEpisode) => playLatestRef.current(ep), []);

  const pause = useCallback(() => {
    userPausedRef.current = true;
    interruptedRef.current = false;
    if (retryPendingRef.current) setIsLoading(false);
    audioRef.current?.pause();
    if (currentEpisode) {
      logPlayerEventLater({
        eventType: "play_pause",
        episodeId: currentEpisode.id,
        podcastId: currentEpisode.podcastId,
        positionSec: audioRef.current?.currentTime,
      });
    }
  }, [currentEpisode]);

  const resume = useCallback(() => {
    userPausedRef.current = false;
    interruptedRef.current = false;
    const a = audioRef.current;
    const ep = currentEpisodeRef.current;
    if (!a) return;
    if (ep) playLatestRef.current(ep);
  }, []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) resume(); else pause();
  }, [pause, resume]);

  const seekTo = useCallback((sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    const from = a.currentTime;
    const max = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : Infinity;
    try { a.currentTime = Math.min(max, Math.max(0, sec)); } catch { /* noop */ }
    if (currentEpisode) queueSeekLog(currentEpisode, from, a.currentTime);
  }, [currentEpisode]);

  const seekBy = useCallback((delta: number) => {
    const a = audioRef.current;
    if (!a) return;
    seekTo((a.currentTime || 0) + delta);
  }, [seekTo]);

  const setPlaybackRate = useCallback((r: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = r;
    setRateState(r);
    if (currentEpisode) {
      logPlayerEventLater({
        eventType: "speed_change",
        episodeId: currentEpisode.id,
        podcastId: currentEpisode.podcastId,
        playbackRate: r,
      });
    }
  }, [currentEpisode]);

  const stop = useCallback(() => {
    userPausedRef.current = true;
    interruptedRef.current = false;
    loadGenRef.current += 1;
    currentEpisodeRef.current = null;
    audioRef.current?.pause();
    setCurrentEpisode(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setExpanded(false);
  }, []);

  const playerVisible = useMemo(() => {
    if (flags.enabled && flags.show_on_public_episode_pages) return true;
    if (flags.dev_preview_enabled && previewActive) return true;
    return false;
  }, [flags, previewActive]);

  // Keep a ref of the current episode so non-React handlers (audio "ended")
  // always see the latest value without stale closures.
  useEffect(() => {
    currentEpisodeRef.current = currentEpisode;
    if (currentEpisode?.id) autoplayHistoryRef.current.add(currentEpisode.id);
  }, [currentEpisode]);

  // Autoplay on episode end.
  //  - mode "related": jump to the most similar cross-podcast episode
  //    (same vector index that powers the "Kapcsolódó" list).
  //  - mode "series":  play the next chronological episode of the SAME podcast
  //    (newer published_at, then asc) so listeners can binge a series in order.
  useEffect(() => {
    autoplayNextRef.current = (ended) => {
      const genAtEnd = loadGenRef.current;
      // A late lookup must not override a manual choice or a stop made meanwhile.
      const stillWanted = () => loadGenRef.current === genAtEnd && currentEpisodeRef.current?.id === ended.id && !userPausedRef.current;
      const play = (next: SmartPlayerEpisode) => { if (stillWanted()) playRef(next); };
      void (async () => {
        try {
          if (autoplayMode === "series" && ended.podcastId) {
            const { data: cur } = await supabase
              .from("episodes")
              .select("published_at")
              .eq("id", ended.id)
              .maybeSingle();
            const curAt = (cur as { published_at?: string | null } | null)?.published_at;
            if (!curAt) return;
            const { data: nextRows } = await supabase
              .from("episodes")
              .select("id,title,display_title,slug,audio_url,podcasts!inner(slug,title,display_title,image_url)")
              .eq("podcast_id", ended.podcastId)
              .gt("published_at", curAt)
              .not("audio_url", "is", null)
              .order("published_at", { ascending: true })
              .limit(1);
            const next = (nextRows || [])[0] as any;
            if (!next) return;
            const pod = Array.isArray(next.podcasts) ? next.podcasts[0] : next.podcasts;
            play({
              id: next.id,
              title: next.display_title || next.title,
              podcastId: ended.podcastId,
              podcastTitle: pod?.display_title || pod?.title || ended.podcastTitle,
              podcastSlug: pod?.slug || ended.podcastSlug,
              episodeSlug: next.slug,
              imageUrl: pod?.image_url || ended.imageUrl,
              audioUrl: next.audio_url,
            });
            return;
          }

          // mode === "related" — cross-podcast vector match. Keep fully off
          // while smart-player recommendations are not editorially trusted.
          if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return;
          const { data, error } = await supabase.rpc("similar_episodes" as never, {
            p_episode_id: ended.id,
            p_limit: 12,
          } as never);
          if (error || !Array.isArray(data)) return;
          const rows = data as Array<{
            episode_id: string;
            podcast_id: string | null;
            title: string;
            display_title: string | null;
            slug: string;
            audio_url: string | null;
            podcast_slug: string;
            podcast_title: string;
            podcast_display_title: string | null;
            podcast_image_url: string | null;
          }>;
          const next = rows.find(
            (r) =>
              !!r.audio_url &&
              r.episode_id !== ended.id &&
              r.podcast_id !== ended.podcastId &&
              !autoplayHistoryRef.current.has(r.episode_id),
          );
          if (!next) return;
          play({
            id: next.episode_id,
            title: next.display_title || next.title,
            podcastId: next.podcast_id,
            podcastTitle: next.podcast_display_title || next.podcast_title,
            podcastSlug: next.podcast_slug,
            episodeSlug: next.slug,
            imageUrl: next.podcast_image_url,
            audioUrl: next.audio_url!,
          });
        } catch {
          /* fail-safe — silence is better than crashing the player */
        }
      })();
    };
  }, [playRef, autoplayMode]);

  const value: Ctx = {
    flags, previewActive, playerVisible, currentEpisode,
    isPlaying, isLoading, error, currentTime, duration, playbackRate,
    expanded, setExpanded,
    autoplayMode, setAutoplayMode,
    play, toggle, pause, resume, seekTo, seekBy, setPlaybackRate, stop,
  };

  return <SmartPlayerCtx.Provider value={value}>{children}</SmartPlayerCtx.Provider>;
}

export function useSmartPlayer() {
  const ctx = useContext(SmartPlayerCtx);
  if (!ctx) throw new Error("useSmartPlayer must be used within SmartPlayerProvider");
  return ctx;
}

export function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export { detectAudioSource };
