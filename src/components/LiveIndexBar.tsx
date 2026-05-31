import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { categoryLabel } from "@/lib/categoryLabels";

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
    language?: string | null;
    is_hungarian?: boolean | null;
    language_decision?: string | null;
  } | null;

};

const HIDE_PREFIXES = ["/admin", "/auth", "/privacy", "/terms", "/admin-bootstrap", "/growth-status"];

// Quiet, single label so the ticker doesn't compete with the hero

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
          .select("id,title,display_title,slug,created_at,published_at,podcasts!inner(slug,title,display_title,category,rss_status,rank_label,language,is_hungarian,language_decision)")
          .or("is_hungarian.eq.true,language_decision.eq.accept_hungarian", { foreignTable: "podcasts" })
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
          .filter((r) => r.title && r.podcasts && r.podcasts.rss_status !== "failed" && r.podcasts.rss_status !== "inactive" && r.podcasts.language_decision !== "reject_foreign")
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
    <div className="hidden min-[400px]:block bg-background text-foreground border-b border-border/70 overflow-hidden">
      {/* Ticker — full width */}
      <div
        className="relative w-full overflow-hidden group"
        aria-label="Frissen indexelt epizódok"
      >
        <ul
          className="flex items-center gap-6 sm:gap-8 whitespace-nowrap text-xs py-1 sm:py-1.5 animate-[ticker_140s_linear_infinite] sm:animate-[ticker_120s_linear_infinite] group-hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] motion-reduce:animate-none"
          style={{ width: "max-content" }}
        >
          {loop.map((it, i) => {
            const epTitle = it.display_title || it.title;
            const podTitle = it.podcasts!.display_title || it.podcasts!.title;
            const displayCategory = categoryLabel(it.podcasts!.category);
            return (
              <li key={`${it.id}-${i}`} className="shrink-0 flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-primary/70 shrink-0" aria-hidden />
                <Link
                  to={`/podcast/${it.podcasts!.slug}/${it.slug}`}
                  className="group/item inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
                >
                  <span className="text-foreground/95 group-hover/item:underline decoration-primary/60 underline-offset-4">
                    {podTitle}
                  </span>
                  <span className="opacity-60">— {epTitle}</span>
                  {displayCategory && (
                    <span className="hidden md:inline opacity-50">· {displayCategory}</span>
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
  );
}
