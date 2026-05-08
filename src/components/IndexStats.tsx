import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

const AVG_EPISODE_MINUTES = 40;
const SAFE_EPISODE_BASELINE = 127_000;
const SAFE_PODCAST_BASELINE = 2_100;

function useCountUp(target: number, durationMs = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!target) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M+`;
  if (n >= 10_000) return `${Math.floor(n / 1000)}K+`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K+`;
  return n.toLocaleString();
}

export default function IndexStats() {
  const [episodeCount] = useState(SAFE_EPISODE_BASELINE);
  const [podcastCount] = useState(SAFE_PODCAST_BASELINE);
  const [lastIndexedAt, setLastIndexedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: latest } = await supabase
        .from("episodes")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLastIndexedAt(latest?.created_at ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalMinutes = episodeCount * AVG_EPISODE_MINUTES;
  const years = totalMinutes / 60 / 24 / 365;

  const epAnim = useCountUp(episodeCount);
  const pdAnim = useCountUp(podcastCount);
  const yrAnim = useCountUp(Math.round(years * 10)) / 10;

  const lastIndexedLabel = (() => {
    if (!lastIndexedAt) return "Live";
    const diff = Date.now() - new Date(lastIndexedAt).getTime();
    const m = Math.max(1, Math.floor(diff / 60000));
    if (m < 60) return `Updated ${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `Updated ${h}h ago`;
    const d = Math.floor(h / 24);
    return `Updated ${d}d ago`;
  })();

  const stats = [
    { label: "Episodes indexed", value: formatCount(epAnim), accent: true },
    {
      label: "Years indexed",
      value: yrAnim ? yrAnim.toFixed(1) : "0",
      suffix: "yrs",
      accent: true,
      tooltip:
        "Estimated from indexed episodes using a 40-minute average episode length.",
    },
    { label: "Podcasts tracked", value: formatCount(pdAnim), accent: true },
    { label: "Growing live", value: lastIndexedLabel, live: true },
  ];

  if (!episodeCount) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <section
        aria-label="Podiverzum index stats"
        className="border-b border-border/70 bg-black/60 backdrop-blur"
      >
        <div className="container mx-auto py-3 sm:py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-lg border border-border/60 bg-card/50 px-3 py-2 sm:px-4 sm:py-3 flex flex-col gap-0.5 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-baseline gap-1.5">
                  {s.live && (
                    <span className="relative inline-flex h-2 w-2 self-center">
                      <span className="pulse-red" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary shadow-[0_0_8px_hsl(var(--brand-red)/0.9)]" />
                    </span>
                  )}
                  <span
                    className={`text-base sm:text-2xl font-bold tracking-tight ${
                      s.accent ? "text-brand-gradient" : "text-foreground"
                    }`}
                  >
                    {s.value}
                  </span>
                  {s.suffix && (
                    <span className="text-xs sm:text-sm text-muted-foreground font-medium">
                      {s.suffix}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  <span className="truncate">{s.label}</span>
                  {s.tooltip && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="text-muted-foreground/70 hover:text-foreground"
                          aria-label="More info"
                        >
                          <Info className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-xs">
                        {s.tooltip}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </TooltipProvider>
  );
}
