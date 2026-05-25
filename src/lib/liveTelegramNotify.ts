// Fire-and-forget Telegram notification for high-signal in-app events.
// Runs only in the browser. Failures are swallowed silently — never blocks UX.
import { supabase } from "@/integrations/supabase/client";

export type LiveEventKind = "search_submit" | "swipe_complete" | "play_start";

function sessionId(): string | null {
  try {
    const k = "podiverzum_player_session";
    let s = sessionStorage.getItem(k);
    if (!s) { s = crypto.randomUUID(); sessionStorage.setItem(k, s); }
    return s;
  } catch {
    return null;
  }
}

function utm(): { utm_source?: string; referrer?: string } {
  if (typeof window === "undefined") return {};
  try {
    const url = new URL(window.location.href);
    return {
      utm_source: url.searchParams.get("utm_source") || undefined,
      referrer: document.referrer || undefined,
    };
  } catch {
    return {};
  }
}

export function notifyLiveEvent(kind: LiveEventKind, payload: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    const merged = { session_id: sessionId(), ...utm(), ...payload };
    // Fire-and-forget — do NOT await
    void supabase.functions.invoke("live-event-notify", { body: { kind, payload: merged } });
  } catch {
    /* fail-safe */
  }
}
