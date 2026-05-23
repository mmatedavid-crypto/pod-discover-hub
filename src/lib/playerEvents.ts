import { supabase } from "@/integrations/supabase/client";
import { recordTasteInteraction } from "@/lib/tasteInteractions";

export type PlayerEventType =
  | "play_start" | "play_pause" | "play_resume" | "play_seek"
  | "play_25" | "play_50" | "play_75" | "play_complete"
  | "playback_error" | "external_open" | "speed_change";

let sessionId: string | null = null;
function getSessionId(): string {
  if (sessionId) return sessionId;
  try {
    const k = "podiverzum_player_session";
    let s = sessionStorage.getItem(k);
    if (!s) { s = crypto.randomUUID(); sessionStorage.setItem(k, s); }
    sessionId = s;
    return s;
  } catch {
    sessionId = crypto.randomUUID();
    return sessionId;
  }
}

export function logPlayerEvent(opts: {
  eventType: PlayerEventType;
  episodeId?: string | null;
  podcastId?: string | null;
  positionSec?: number;
  durationSec?: number;
  playbackRate?: number;
  meta?: Record<string, unknown>;
}) {
  try {
    void supabase.from("player_events" as any).insert({
      event_type: opts.eventType,
      episode_id: opts.episodeId ?? null,
      podcast_id: opts.podcastId ?? null,
      session_id: getSessionId(),
      position_sec: typeof opts.positionSec === "number" ? Math.floor(opts.positionSec) : null,
      duration_sec: typeof opts.durationSec === "number" ? Math.floor(opts.durationSec) : null,
      playback_rate: typeof opts.playbackRate === "number" ? opts.playbackRate : null,
      viewport_width: typeof window !== "undefined" ? window.innerWidth : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      meta: (opts.meta ?? {}) as never,
    });
  } catch {
    /* fail-safe */
  }

  // Mirror to taste-vector pipeline for select event types.
  try {
    if (opts.eventType === "play_start") {
      void recordTasteInteraction(opts.episodeId ?? null, "play_start", "player");
    } else if (opts.eventType === "play_complete") {
      void recordTasteInteraction(opts.episodeId ?? null, "play_complete", "player");
    }
  } catch {
    /* fail-safe */
  }
}
