import { useEffect, useRef } from "react";
import { useInRouterContext, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { isBotUserAgent } from "@/lib/botDetect";
import { getAnalyticsSessionId } from "@/lib/analyticsSession";

const SKIP_PREFIXES = ["/admin", "/auth", "/belepes", "/growth-status", "/admin-bootstrap"];

function parseUA(ua: string): { browser: string; os: string; isBot: boolean } {
  const u = ua || "";
  const isBot = isBotUserAgent(u);
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
  return { browser, os, isBot };
}

/** Analytics must never blank the page: outside a router (e.g. mid hot-reload) it is a no-op. */
export default function PageViewTracker() {
  return useInRouterContext() ? <RoutedPageViewTracker /> : null;
}

function RoutedPageViewTracker() {
  const location = useLocation();
  const lastLogged = useRef<string | null>(null);
  const currentEventId = useRef<string | null>(null);
  const enterTime = useRef<number>(Date.now());

  // Flush dwell on tab close / hide
  useEffect(() => {
    function flush() {
      const id = currentEventId.current;
      if (!id) return;
      const dwell = Date.now() - enterTime.current;
      if (dwell < 500 || dwell > 24 * 3600 * 1000) return;
      try {
        supabase.rpc("update_page_event_dwell", { _id: id, _dwell_ms: dwell });
      } catch { /* ignore */ }
    }
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  useEffect(() => {
    const path = location.pathname;
    if (SKIP_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) return;

    const key = path + location.search;
    if (lastLogged.current === key) return;

    // Flush previous page dwell before starting new
    if (currentEventId.current) {
      const prevDwell = Date.now() - enterTime.current;
      if (prevDwell >= 500 && prevDwell <= 24 * 3600 * 1000) {
        try {
          supabase.rpc("update_page_event_dwell", {
            _id: currentEventId.current,
            _dwell_ms: prevDwell,
          });
        } catch { /* ignore */ }
      }
    }

    lastLogged.current = key;
    enterTime.current = Date.now();

    const eventId = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    currentEventId.current = eventId;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user.id ?? null;
        const params = new URLSearchParams(location.search);
        const utm = (k: string) => params.get(k) || null;
        const { browser, os, isBot } = parseUA(navigator.userAgent);
        await supabase.from("page_events").insert({
          id: eventId,
          path,
          full_url: window.location.href,
          referrer: document.referrer || null,
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
          is_bot: isBot,
        });
      } catch {
        /* swallow — analytics must never break the app */
      }
    })();
  }, [location.pathname, location.search]);

  return null;
}
