// Cookieless, first-party landing/funnel analytics.
// No cookies, no Meta Pixel, no third-party tracking, no fingerprinting.
// Anonymous session id lives in sessionStorage only (cleared on tab close).
// UTM params are snapshotted once per session so the whole funnel keeps attribution.

import { supabase } from "@/integrations/supabase/client";

export type LandingEventName =
  | "LandingViewed"
  | "SwipeStarted"
  | "SwipeCompleted"
  | "ResultViewed"
  | "ResultShared"
  | "RegistrationOffered"
  | "RegistrationStarted"
  | "RegistrationCompleted";

const SID_KEY = "pv_anon_sid";          // session-only anonymous id
const UTM_KEY = "pv_utm_snapshot";      // session-only utm snapshot
const VARIANT_KEY = "pv_landing_variant";

type UtmSnapshot = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  landing_variant: string | null;
  referrer_domain: string | null;
};

function safeSession(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

function getAnonSessionId(): string {
  const ss = safeSession();
  if (!ss) return "no-session";
  let id = ss.getItem(SID_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    ss.setItem(SID_KEY, id);
  }
  return id;
}

function referrerDomain(): string | null {
  try {
    if (!document.referrer) return null;
    const u = new URL(document.referrer);
    if (u.hostname === window.location.hostname) return null;
    return u.hostname;
  } catch { return null; }
}

function deviceType(): "mobile" | "tablet" | "desktop" {
  const w = window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

/** Snapshot UTM params once per session. Call on first landing.
 *  Supports short aliases: ?c=campaign, ?s=source, ?m=medium, ?ct=content, ?v=variant.
 *  Full utm_* params still work and take precedence.
 */
export function snapshotUtmFromUrl(): UtmSnapshot {
  const ss = safeSession();
  const params = new URLSearchParams(window.location.search);
  const get = (long: string, short: string) => params.get(long) ?? params.get(short);

  const utm_source = get("utm_source", "s");
  const utm_medium = get("utm_medium", "m");
  const utm_campaign = get("utm_campaign", "c");
  const utm_content = get("utm_content", "ct");
  const utm_term = params.get("utm_term");
  const variantParam = params.get("v") || params.get("variant");
  const has = utm_source || utm_medium || utm_campaign || utm_content || utm_term;

  let snap: UtmSnapshot;
  if (has || variantParam || !ss?.getItem(UTM_KEY)) {
    snap = {
      utm_source,
      utm_medium: utm_medium ?? (utm_source ? "social" : null),
      utm_campaign,
      utm_content,
      utm_term,
      landing_variant: variantParam,
      referrer_domain: referrerDomain(),
    };
    try { ss?.setItem(UTM_KEY, JSON.stringify(snap)); } catch { /* ignore */ }
    if (variantParam) { try { ss?.setItem(VARIANT_KEY, variantParam); } catch { /* ignore */ } }
  } else {
    try { snap = JSON.parse(ss.getItem(UTM_KEY) || "{}"); }
    catch { snap = { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null, landing_variant: null, referrer_domain: null }; }
  }
  return snap;
}


function getUtm(): UtmSnapshot {
  const ss = safeSession();
  if (!ss) return { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null, landing_variant: null, referrer_domain: null };
  try {
    const raw = ss.getItem(UTM_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return snapshotUtmFromUrl();
}

/** Track a privacy-safe funnel event. Fire-and-forget. */
export function trackLandingEvent(eventName: LandingEventName, meta: Record<string, unknown> = {}) {
  try {
    const utm = getUtm();
    void supabase.from("landing_events").insert({
      anonymous_session_id: getAnonSessionId(),
      event_name: eventName,
      utm_source: utm.utm_source,
      utm_medium: utm.utm_medium,
      utm_campaign: utm.utm_campaign,
      utm_content: utm.utm_content,
      utm_term: utm.utm_term,
      landing_variant: utm.landing_variant,
      path: window.location.pathname,
      referrer_domain: utm.referrer_domain,
      device_type: deviceType(),
      meta: meta as never,
    });
  } catch {
    /* analytics must never break the app */
  }
}
