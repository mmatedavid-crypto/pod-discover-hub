// Phase-1 product analytics layer (PostHog).
//
// Design rules (see docs/analytics-measurement.md):
//  - Existing Supabase `page_events` / `search_events` / `player_events` stay
//    untouched and remain the first-party control source.
//  - PostHog is a SECOND, additive layer. Automatic `$pageview` is diagnostic
//    only; the KPIs are the custom human-intent events below.
//  - Only real production hosts are ingested. No localhost, no Lovable
//    previews, no admin/auth routes, no known crawler UAs.
//  - No session recording, no PII, no raw search query text.
//  - Every call fails silently: analytics must never break the UI.

import type { PostHog } from "posthog-js";
import { isBotClient } from "./botDetect";

const FALLBACK_TOKEN = "phc_zxwiXA6Zuvp9cUoptWSW43noc58cve2hHX2UbGfJ4NhV";
const FALLBACK_HOST = "https://eu.i.posthog.com";

const PRODUCTION_HOSTS = new Set(["podiverzum.hu", "www.podiverzum.hu"]);

const SKIP_PATH_PREFIXES = [
  "/admin",
  "/auth",
  "/belepes",
  "/growth-status",
  "/admin-bootstrap",
];

/** Exact, closed product-event taxonomy for phase 1. */
export type AnalyticsEventName =
  | "human_interaction"
  | "search_submitted"
  | "search_result_opened"
  | "episode_play_started"
  | "episode_play_25"
  | "episode_play_50"
  | "episode_play_75"
  | "episode_play_completed"
  | "episode_playback_error"
  | "external_listen_opened";

export type AnalyticsProps = Record<string, string | number | boolean | null>;

export type SearchSubmitSource = "search_page" | "ask_podiverzum" | "example";

export type SearchResultKind =
  | "episode"
  | "podcast"
  | "person"
  | "organization"
  | "topic"
  | "other";

let client: PostHog | null = null;
let initTried = false;

function readEnv(key: string): string | undefined {
  try {
    const v = (import.meta.env as Record<string, string | undefined>)[key];
    return v && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function getProjectToken(): string {
  return readEnv("VITE_POSTHOG_PROJECT_TOKEN") || FALLBACK_TOKEN;
}

export function getApiHost(): string {
  return readEnv("VITE_POSTHOG_HOST") || FALLBACK_HOST;
}

function isProductionHost(): boolean {
  if (typeof window === "undefined") return false;
  return PRODUCTION_HOSTS.has(window.location.hostname);
}

function isSkippedPath(pathname: string): boolean {
  return SKIP_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** True when this browser/route/host combination may emit analytics at all. */
export function analyticsEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (!isProductionHost()) return false;
    if (isBotClient()) return false;
    return true;
  } catch {
    return false;
  }
}

export function viewportClass(): "mobile" | "tablet" | "desktop" {
  const w = typeof window === "undefined" ? 0 : window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

export function analyticsInitialized(): boolean {
  return initTried;
}

/** Called by AnalyticsProvider after posthog-js has been initialized. */
export function registerClient(instance: PostHog | null): void {
  client = instance;
  initTried = true;
}

export function getClient(): PostHog | null {
  return client;
}

/** Low-level, always-silent capture. */
export function trackEvent(name: AnalyticsEventName, props: AnalyticsProps = {}): void {
  try {
    if (!client || !analyticsEnabled()) return;
    const path = window.location.pathname;
    if (isSkippedPath(path)) return;
    client.capture(name, { path, viewport_class: viewportClass(), ...props });
  } catch {
    /* analytics must never break the UI */
  }
}

// ---------------------------------------------------------------------------
// human_interaction — once per browser tab/session, on first trusted input
// ---------------------------------------------------------------------------

const HUMAN_FLAG_KEY = "pv_ph_human_interaction";
let humanListenersBound = false;

function alreadyMarkedHuman(): boolean {
  try {
    return sessionStorage.getItem(HUMAN_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function markHuman(): void {
  try {
    sessionStorage.setItem(HUMAN_FLAG_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function bindHumanInteractionTracking(): () => void {
  if (humanListenersBound || typeof window === "undefined") return () => {};
  humanListenersBound = true;

  const handler = (event: Event) => {
    if (!event.isTrusted) return;
    detach();
    if (alreadyMarkedHuman()) return;
    markHuman();
    trackEvent("human_interaction", { input_type: event.type });
  };

  const types = ["pointerdown", "touchstart", "keydown"] as const;
  const detach = () => {
    types.forEach((t) => window.removeEventListener(t, handler, true));
  };
  types.forEach((t) => window.addEventListener(t, handler, { capture: true, passive: true }));
  return detach;
}

// ---------------------------------------------------------------------------
// Narrow typed product API
// ---------------------------------------------------------------------------

/**
 * An explicit, user-initiated search. NEVER call this from a URL/`?q=` render
 * effect — only from a real submit/click handler.
 */
export function trackSearchSubmitted(query: string, source: SearchSubmitSource): void {
  const q = (query || "").trim();
  if (!q) return;
  trackEvent("search_submitted", {
    source,
    query_length: q.length,
    terms_count: q.split(/\s+/).filter(Boolean).length,
  });
}

/** A trusted click that opens a result from the /kereses results page. */
export function trackSearchResultOpened(input: {
  resultKind: SearchResultKind;
  episodeId?: string | null;
  podcastId?: string | null;
  slug?: string | null;
}): void {
  trackEvent("search_result_opened", {
    source: "search",
    result_kind: input.resultKind,
    episode_id: input.episodeId ?? null,
    podcast_id: input.podcastId ?? null,
    slug: input.slug ?? null,
  });
}

const PLAYER_EVENT_MAP: Record<string, AnalyticsEventName> = {
  play_start: "episode_play_started",
  play_25: "episode_play_25",
  play_50: "episode_play_50",
  play_75: "episode_play_75",
  play_complete: "episode_play_completed",
  playback_error: "episode_playback_error",
  external_open: "external_listen_opened",
};

/**
 * Mirror of the existing Supabase player events. `meta` is intentionally NOT
 * forwarded — it is a free-form bag and cannot be guaranteed PII-free.
 */
export function trackPlayerEvent(input: {
  eventType: string;
  episodeId?: string | null;
  podcastId?: string | null;
  positionSec?: number;
  durationSec?: number;
  playbackRate?: number;
}): void {
  const name = PLAYER_EVENT_MAP[input.eventType];
  if (!name) return;
  trackEvent(name, {
    episode_id: input.episodeId ?? null,
    podcast_id: input.podcastId ?? null,
    position_sec: Number.isFinite(input.positionSec) ? Math.round(input.positionSec as number) : null,
    duration_sec: Number.isFinite(input.durationSec) ? Math.round(input.durationSec as number) : null,
    playback_rate: Number.isFinite(input.playbackRate) ? (input.playbackRate as number) : null,
  });
}
