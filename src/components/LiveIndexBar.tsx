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

  // Duplicate the list for a seamless marquee loop
  const loop = [...items, ...items];

  return (
    <div className="border-b border-border/70 bg-gradient-to-r from-card via-background to-card overflow-hidden">
      <div className="container mx-auto flex items-stretch gap-0 px-0 sm:px-6 max-w-full">
        {/* ON AIR label */}
        <div className="shrink-0 flex items-center gap-2 pl-3 sm:pl-0 pr-3 sm:pr-4 py-2 border-r border-border/60">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping motion-reduce:hidden" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_hsl(156_72%_55%/0.85)]" />
          </span>
          <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/90">
            On Air
          </span>
          <span className="hidden sm:inline text-[11px] uppercase tracking-wider text-muted-foreground">
            · newly indexed episodes
          </span>
        </div>

        {/* Ticker */}
        <div
          className="relative flex-1 min-w-0 overflow-hidden group"
          aria-label="Newly indexed episodes ticker"
        >
          <ul
            className="flex items-center gap-8 whitespace-nowrap text-xs py-2 animate-[ticker_90s_linear_infinite] sm:animate-[ticker_80s_linear_infinite] group-hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] motion-reduce:animate-none"
            style={{ width: "max-content" }}
          >
            {loop.map((it, i) => (
              <li key={`${it.id}-${i}`} className="shrink-0 flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-emerald-500/70 shrink-0" aria-hidden />
                <Link
                  to={`/podcast/${it.podcasts!.slug}/${it.slug}`}
                  className="group/item inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
                >
                  <span className="text-foreground/90 group-hover/item:underline">{it.title}</span>
                  <span className="opacity-60">— {it.podcasts!.title}</span>
                  {it.podcasts!.category && (
                    <span className="hidden md:inline opacity-50">· {it.podcasts!.category}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {/* Edge fade masks */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
        </div>
      </div>
    </div>
  );
}
