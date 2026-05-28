import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isPlayerPreviewActive } from "@/lib/playerPreview";
import { detectAudioSource } from "@/lib/playerAudio";
import { getProgress, saveProgress, markPlayCount } from "@/lib/playerProgress";
import { logPlayerEvent } from "@/lib/playerEvents";
import { notifyLiveEvent } from "@/lib/liveTelegramNotify";

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

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const markedRef = useRef<Set<string>>(new Set());

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
    const onDur = () => setDuration(a.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWait = () => setIsLoading(true);
    const onCanPlay = () => setIsLoading(false);
    const onError = () => {
      setError("Playback error");
      setIsPlaying(false);
      setIsLoading(false);
      logPlayerEvent({
        eventType: "playback_error",
        episodeId: currentEpisode?.id,
        podcastId: currentEpisode?.podcastId,
      });
    };
    const onEnded = () => {
      setIsPlaying(false);
      if (currentEpisode) {
        saveProgress(currentEpisode.id, a.currentTime, a.duration, true);
        logPlayerEvent({
          eventType: "play_complete",
          episodeId: currentEpisode.id,
          podcastId: currentEpisode.podcastId,
          positionSec: a.currentTime,
          durationSec: a.duration,
        });
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

  useEffect(() => {
    if (!currentEpisode || !duration) return;
    const id = currentEpisode.id;
    if (currentTime > 0 && Math.floor(currentTime) % 10 === 0) {
      saveProgress(id, currentTime, duration);
    }
    PROGRESS_MARKERS.forEach((m) => {
      const key = `${id}:${m.type}`;
      if (currentTime / duration >= m.pct && !markedRef.current.has(key)) {
        markedRef.current.add(key);
        logPlayerEvent({
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
      navigator.mediaSession.setActionHandler("play", () => audioRef.current?.play());
      navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
      navigator.mediaSession.setActionHandler("seekbackward", () => {
        if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15);
      });
      navigator.mediaSession.setActionHandler("seekforward", () => {
        if (audioRef.current) audioRef.current.currentTime = audioRef.current.currentTime + 30;
      });
    } catch { /* noop */ }
  }, [currentEpisode]);

  const play = useCallback((ep: SmartPlayerEpisode, opts?: { resume?: boolean }) => {
    const a = audioRef.current;
    if (!a) return;
    setError(null);
    const same = currentEpisode?.id === ep.id;
    if (!same) {
      setCurrentEpisode(ep);
      markedRef.current = new Set();
      a.src = ep.audioUrl;
      const prog = getProgress(ep.id);
      if (opts?.resume && prog && prog.currentTime > 30 && !prog.completed) {
        try { a.currentTime = prog.currentTime; } catch { /* noop */ }
      }
      markPlayCount(ep.id);
      logPlayerEvent({
        eventType: "play_start",
        episodeId: ep.id,
        podcastId: ep.podcastId,
        positionSec: a.currentTime,
      });
      notifyLiveEvent("play_start", {
        episode_id: ep.id,
        episode_title: ep.title,
        podcast_title: ep.podcastTitle,
        episode_url: typeof window !== "undefined" ? window.location.href : undefined,
      });
    } else {
      logPlayerEvent({
        eventType: "play_resume",
        episodeId: ep.id,
        podcastId: ep.podcastId,
        positionSec: a.currentTime,
      });
    }
    setIsLoading(true);
    void a.play().catch(() => {
      setError("Playback error");
      setIsLoading(false);
    });
  }, [currentEpisode]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    if (currentEpisode) {
      logPlayerEvent({
        eventType: "play_pause",
        episodeId: currentEpisode.id,
        podcastId: currentEpisode.podcastId,
        positionSec: audioRef.current?.currentTime,
      });
    }
  }, [currentEpisode]);

  const resume = useCallback(() => {
    audioRef.current?.play().catch(() => setError("Playback error"));
  }, []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) resume(); else pause();
  }, [pause, resume]);

  const seekTo = useCallback((sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    try { a.currentTime = Math.max(0, sec); } catch { /* noop */ }
    if (currentEpisode) {
      logPlayerEvent({
        eventType: "play_seek",
        episodeId: currentEpisode.id,
        podcastId: currentEpisode.podcastId,
        positionSec: a.currentTime,
      });
    }
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
      logPlayerEvent({
        eventType: "speed_change",
        episodeId: currentEpisode.id,
        podcastId: currentEpisode.podcastId,
        playbackRate: r,
      });
    }
  }, [currentEpisode]);

  const stop = useCallback(() => {
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

  const value: Ctx = {
    flags, previewActive, playerVisible, currentEpisode,
    isPlaying, isLoading, error, currentTime, duration, playbackRate,
    expanded, setExpanded,
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
