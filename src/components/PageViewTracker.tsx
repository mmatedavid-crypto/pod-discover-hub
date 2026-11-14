import { useEffect } from "react";
import { useInRouterContext, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { isBotClient } from "@/lib/botDetect";
import { getAnalyticsSessionId } from "@/lib/analyticsSession";
import { pageViewDecision, type PageViewState } from "@/lib/pageViewDedupe";

const SKIP_PREFIXES = ["/admin", "/auth", "/belepes", "/growth-status", "/admin-bootstrap"];

function parseUA(ua: string): { browser: string; os: string } {
  const u = ua || "";
  let browser = "Other";
  if (/edg\//i.test(u)) browser = "Edge";
  else if (/chrome\//i.test(u) && !/edg\//i.test(u)) browser = "Chrome";
  else if (/firefox\//i.test(u)) browser = "Firefox";
  else if (/safari\//i.test(u) && !/chrome\//i.test(u)) browser = "Safari";
  else if (/opr\//i.test(u)) browser = "Opera";
  let os = "Other";
  if (/windows/i.test(u)) os = "Windows";
  else if (/android/i.test(u)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(u)) os = "iOS";
  else if (/mac os x/i.test(u)) os = "macOS";
  else if (/linux/i.test(u)) os = "Linux";
  return { browser, os };
}

// Module-level state: survives a remount of the tracker, which previously logged the
// landing page twice within ~10 ms (≈35% of page_events rows in Nov 2026 were such copies).
const state: PageViewState = { lastKey: null, lastAt: 0, prevUrl: null };
let current: { id: string; visibleMs: number; visibleSince: number | null; sent: boolean } | null = null;

/** Send the visible time of the current view once. keepalive lets it survive tab close. */
function flushDwell() {
  const c = current;
  if (!c || c.sent) return;
  const visible = c.visibleMs + (c.visibleSince != null ? Date.now() - c.visibleSince : 0);
  if (visible < 500 || visible > 24 * 3600 * 1000) return;
  c.sent = true;
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    if (!url || !key) return;
    void fetch(`${url}/rest/v1/rpc/update_page_event_dwell`, {
      method: "POST",
      keepalive: true,
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ _id: c.id, _dwell_ms: Math.round(visible) }),
    }).catch(() => { /* analytics must never break the app */ });
  } catch { /* ignore */ }
}

/** Analytics must never blank the page: outside a router (e.g. mid hot-reload) it is a no-op. */
export default function PageViewTracker() {
  return useInRouterContext() ? <RoutedPageViewTracker /> : null;
}

function RoutedPageViewTracker() {
  const location = useLocation();

  useEffect(() => {
    const onVis = () => {
      const c = current;
      if (!c) return;
      if (document.visibilityState === "hidden") {
        if (c.visibleSince != null) { c.visibleMs += Date.now() - c.visibleSince; c.visibleSince = null; }
        flushDwell();
      } else if (c.visibleSince == null) {
        c.visibleSince = Date.now();
      }
    };
    window.addEventListener("pagehide", flushDwell);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flushDwell);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    const path = location.pathname;
    if (SKIP_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) return;

    const href = window.location.href;
    const decision = pageViewDecision(state, path + location.search, href, document.referrer || null, Date.now());
    if (!decision.log) return;

    flushDwell();
    const eventId = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    current = {
      id: eventId,
      visibleMs: 0,
      visibleSince: document.visibilityState === "hidden" ? null : Date.now(),
      sent: false,
    };

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user.id ?? null;
        const params = new URLSearchParams(location.search);
        const utm = (k: string) => params.get(k) || null;
        const { browser, os } = parseUA(navigator.userAgent);
        await supabase.from("page_events").insert({
          id: eventId,
          path,
          full_url: href,
          // First view in the tab: the external referrer; later SPA views: the previous in-app URL,
          // so internal navigation is no longer counted as another Google arrival.
          referrer: decision.referrer,
          viewport_width: window.innerWidth,
          user_id: uid,
          utm_source: utm("utm_source"),
          utm_medium: utm("utm_medium"),
          utm_campaign: utm("utm_campaign"),
          utm_term: utm("utm_term"),
          utm_content: utm("utm_content"),
          session_id: getAnalyticsSessionId(),
          ua_browser: browser,
          ua_os: os,
          is_bot: isBotClient(),
        });
      } catch {
        /* swallow — analytics must never break the app */
      }
    })();
  }, [location.pathname, location.search]);

  return null;
}
