import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

type Item = {
  id: string;
  title: string;
  slug: string;
  created_at: string;
  published_at: string | null;
  podcasts: { slug: string; title: string; category: string | null; rss_status: string; podiverzum_rank: number } | null;
};

const HIDE_PREFIXES = ["/admin", "/auth", "/privacy", "/terms", "/admin-bootstrap", "/growth-status"];

export default function LiveIndexBar() {
  const { pathname } = useLocation();
  const [items, setItems] = useState<Item[]>([]);
  const hidden = HIDE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("episodes")
          .select("id,title,slug,created_at,published_at,podcasts!inner(slug,title,category,rss_status,podiverzum_rank)")
          .gte("podcasts.podiverzum_rank", 4)
          .not("podcasts.rss_status", "in", "(failed,inactive)")
          .not("title", "is", null)
          .order("created_at", { ascending: false })
          .limit(20);

        if (cancelled || !data) return;
        const rows = (data as unknown as Item[]).filter((r) => r.title && r.podcasts);
        // Prefer last 72h if we have enough; otherwise show whatever is freshest
        const cutoff = Date.now() - 72 * 3600 * 1000;
        const recent = rows.filter((r) => new Date(r.created_at).getTime() >= cutoff);
        setItems(recent.length >= 6 ? recent : rows);
      } catch {
        /* silent */
      }
    })();
    return () => { cancelled = true; };
  }, [hidden, pathname]);

  if (hidden || items.length === 0) return null;

  return (
    <div className="border-b border-border bg-card/60 backdrop-blur-sm">
      <div className="container mx-auto flex items-center gap-3 px-3 sm:px-6 py-2 overflow-hidden">
        <div className="hidden sm:flex items-center gap-2 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-foreground/40 opacity-60 animate-ping" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-foreground/80" />
          </span>
          <span className="font-medium text-foreground/80">Live Index</span>
          <span className="text-muted-foreground">· newly indexed episodes</span>
        </div>
        <div className="flex sm:hidden items-center gap-1.5 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-foreground/40 opacity-60 animate-ping" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-foreground/80" />
          </span>
          <span className="font-medium text-foreground/80">Live Index</span>
        </div>
        <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
          <ul className="flex items-center gap-4 whitespace-nowrap text-xs">
            {items.map((it) => (
              <li key={it.id} className="shrink-0">
                <Link
                  to={`/podcast/${it.podcasts!.slug}/${it.slug}`}
                  className="group inline-flex items-center gap-2 hover:text-foreground text-muted-foreground"
                >
                  <span className="text-foreground/90 group-hover:underline truncate max-w-[60vw] sm:max-w-[28ch]">{it.title}</span>
                  <span className="opacity-60">— {it.podcasts!.title}</span>
                  {it.podcasts!.category && (
                    <span className="hidden md:inline opacity-50">· {it.podcasts!.category}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
