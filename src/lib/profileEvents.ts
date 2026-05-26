// Privacy-safe first-party event logger a Hallgatói Profil flow-hoz.
// Az event-eket a meglévő `landing_events` táblába rakjuk a meta JSONB-n
// keresztül, hogy ne kelljen új tábla. Nincs cookie, nincs Meta Pixel.

import { supabase } from "@/integrations/supabase/client";

export type ProfileEventName =
  | "swipe_started"
  | "swipe_completed"
  | "profile_generated"
  | "profile_share_clicked"
  | "profile_image_downloaded"
  | "profile_link_copied"
  | "shared_profile_viewed"
  | "shared_profile_cta_clicked"
  | "second_generation_from_shared_profile"
  | "episode_click_after_profile";

const SID_KEY = "pv_anon_sid";
const REF_KEY = "pv_source_profile_id";

function safeSession(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

function getAnonSessionId(): string {
  const ss = safeSession();
  if (!ss) return "no-session";
  let id = ss.getItem(SID_KEY);
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    ss.setItem(SID_KEY, id);
  }
  return id;
}

/** A `?ref=<share_id>` paraméter eltárolása (új session-höz). */
export function captureSourceProfileFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref") || params.get("source");
    const ss = safeSession();
    if (ref && ss && !ss.getItem(REF_KEY)) ss.setItem(REF_KEY, ref);
    return ref;
  } catch {
    return null;
  }
}

export function getSourceProfileId(): string | null {
  const ss = safeSession();
  return ss?.getItem(REF_KEY) ?? null;
}

function getUtm(): Record<string, string | null> {
  try {
    const raw = safeSession()?.getItem("pv_utm_snapshot");
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

export function trackProfileEvent(
  name: ProfileEventName,
  extra: {
    share_id?: string | null;
    archetype_id?: string | null;
    [k: string]: unknown;
  } = {},
) {
  try {
    const utm = getUtm();
    const meta = {
      event_kind: "listener_profile",
      event_name: name,
      share_id: extra.share_id ?? null,
      source_profile_id: getSourceProfileId(),
      archetype_id: extra.archetype_id ?? null,
      referrer: typeof document !== "undefined" ? document.referrer || null : null,
      ...extra,
    };
    supabase
      .from("landing_events")
      .insert({
        anonymous_session_id: getAnonSessionId(),
        // A landing_events.event_name oszlop CHECK constraint-ot tartalmazhat —
        // a meglévő engedélyezett "ResultViewed"-et használjuk burokként, az
        // igazi név a meta-ban van.
        event_name: "ResultViewed",
        utm_source: (utm.utm_source as string | null) ?? null,
        utm_medium: (utm.utm_medium as string | null) ?? null,
        utm_campaign: (utm.utm_campaign as string | null) ?? null,
        utm_content: (utm.utm_content as string | null) ?? null,
        utm_term: (utm.utm_term as string | null) ?? null,
        landing_variant: (utm.landing_variant as string | null) ?? null,
        path: window.location.pathname,
        referrer_domain: null,
        device_type:
          window.innerWidth < 640 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop",
        meta: meta as never,
      })
      .then(() => {}, () => {});
  } catch {
    /* analytics never breaks the app */
  }
}
