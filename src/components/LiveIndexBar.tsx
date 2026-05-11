import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

type Item = {
  id: string;
  title: string;
  display_title?: string | null;
  slug: string;
  created_at: string;
  published_at: string | null;
  podcasts: {
    slug: string;
    title: string;
    display_title?: string | null;
    category: string | null;
    rss_status: string;
    rank_label: string | null;
  } | null;
};

const HIDE_PREFIXES = ["/admin", "/auth", "/privacy", "/terms", "/admin-bootstrap", "/growth-status"];

// Rotating prefix labels so the ticker feels like a live activity feed
const PREFIXES = [
  "Now indexed",
  "Fresh episode",
  "Just added",
  "New in index",
];

export default function LiveIndexBar() {
  const { pathname } = useLocation();
  const [items, setItems] = useState<Item[]>([]);
  const hidden = HIDE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("episodes")
          .select("id,title,display_title,slug,created_at,published_at,podcasts!inner(slug,title,display_title,category,rss_status,rank_label)")
          .in("podcasts.rank_label", ["S", "A", "B"])
          .not("title", "is", null)
          .order("created_at", { ascending: false })
          .limit(40);

        if (cancelled) return;
        if (error) {
          console.warn("LiveIndexBar query error", error);
          return;
        }
        const looksLikeJunk = (t: string) =>
          /\bhttps?:\/\//i.test(t) ||
          /\bwww\./i.test(t) ||
          /\.(gov|com|org|net)\b/i.test(t) ||
          /\bday\s*\d+\b.*\bpart\s*\d+\b/i.test(t) ||
          t.length > 90;
        const trim = (t: string) => (t.length > 70 ? t.slice(0, 67).trimEnd() + "…" : t);
        const rows = ((data || []) as unknown as Item[])
          .filter((r) => r.title && r.podcasts && r.podcasts.rss_status !== "failed" && r.podcasts.rss_status !== "inactive")
          .filter((r) => !looksLikeJunk(r.display_title || r.title))
          .map((r) => ({ ...r, display_title: trim(r.display_title || r.title), title: trim(r.title) }));
        // Prefer most recent ~72h window, but always keep at least 8 items so the marquee fills.
        const cutoff = Date.now() - 72 * 3600 * 1000;
        const recent = rows.filter((r) => new Date(r.created_at).getTime() >= cutoff);
        const chosen = (recent.length >= 8 ? recent : rows).slice(0, 24);
        setItems(chosen);
      } catch (e) {
        console.warn("LiveIndexBar failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hidden, pathname]);

  if (hidden || items.length === 0) return null;

  // Duplicate the list for a seamless marquee loop
  const loop = [...items, ...items];

  return (
    <div className="bg-background text-foreground border-b border-border/70 overflow-hidden">
      <div className="flex items-stretch w-full">
        {/* LIVE label */}
        <div className="shrink-0 flex items-center gap-2 pl-3 sm:pl-4 pr-2.5 sm:pr-4 py-1 sm:py-1.5 border-r border-border/60 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent">
          <span className="relative inline-flex h-2 w-2">
            <span className="pulse-red" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary shadow-[0_0_10px_hsl(var(--brand-red)/0.95)]" />
          </span>
          <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.22em] text-foreground">
            Live
          </span>
          <span className="hidden sm:inline text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            · Now indexing
          </span>
        </div>

        {/* Ticker */}
        <div
          className="relative flex-1 min-w-0 overflow-hidden group"
          aria-label="Live index — recently indexed episodes"
        >
          <ul
            className="flex items-center gap-6 sm:gap-8 whitespace-nowrap text-xs py-1.5 animate-[ticker_140s_linear_infinite] sm:animate-[ticker_120s_linear_infinite] group-hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] motion-reduce:animate-none"
            style={{ width: "max-content" }}
          >
            {loop.map((it, i) => {
              const prefix = PREFIXES[i % PREFIXES.length];
              const epTitle = it.display_title || it.title;
              const podTitle = it.podcasts!.display_title || it.podcasts!.title;
              return (
                <li key={`${it.id}-${i}`} className="shrink-0 flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-primary/70 shrink-0" aria-hidden />
                  <span className="text-[10px] uppercase tracking-[0.16em] text-primary/80 font-semibold shrink-0">
                    {prefix}:
                  </span>
                  <Link
                    to={`/podcast/${it.podcasts!.slug}/${it.slug}`}
                    className="group/item inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
                  >
                    <span className="text-foreground/95 group-hover/item:underline decoration-primary/60 underline-offset-4">
                      {podTitle}
                    </span>
                    <span className="opacity-60">— {epTitle}</span>
                    {it.podcasts!.category && (
                      <span className="hidden md:inline opacity-50">· {it.podcasts!.category}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          {/* Edge fade masks */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
        </div>
      </div>
    </div>
  );
}
