import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const SKIP_PREFIXES = ["/admin", "/auth", "/growth-status", "/admin-bootstrap"];

export default function PageViewTracker() {
  const location = useLocation();
  const lastLogged = useRef<string | null>(null);

  useEffect(() => {
    const path = location.pathname;
    if (SKIP_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) return;

    // dedupe consecutive identical paths (StrictMode double-mount, etc.)
    const key = path + location.search;
    if (lastLogged.current === key) return;
    lastLogged.current = key;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user.id ?? null;
        await supabase.from("page_events").insert({
          path,
          full_url: window.location.href,
          referrer: document.referrer || null,
          viewport_width: window.innerWidth,
          user_id: uid,
        });
      } catch {
        /* swallow — analytics must never break the app */
      }
    })();
  }, [location.pathname, location.search]);

  return null;
}
