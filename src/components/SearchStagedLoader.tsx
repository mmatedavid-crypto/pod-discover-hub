import { useEffect, useState } from "react";

// Premium, calm, non-technical staged loading copy. No mention of embeddings,
// vectors, models, AI pipeline, etc. Designed to convey that the system is
// understanding the query, not just matching titles.
const STAGES = [
  "Keresés az epizódok jelentése alapján…",
  "Témák, személyek és podcastok összevetése…",
  "A találatok pontosítása…",
];
const LONG_WAIT_COPY = "Még pontosítjuk a találatokat…";

type Props = { query: string };

export function SearchStagedLoader({ query }: Props) {
  const [stage, setStage] = useState(0);
  const [longWait, setLongWait] = useState(false);

  useEffect(() => {
    setStage(0);
    setLongWait(false);
    const t1 = setTimeout(() => setStage(1), 700);
    const t2 = setTimeout(() => setStage(2), 1600);
    const t3 = setTimeout(() => setLongWait(true), 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [query]);

  const line = longWait ? LONG_WAIT_COPY : STAGES[stage];

  return (
    <div
      className="mt-6 sm:mt-8 p-4 sm:p-6 rounded-xl border border-border/70 bg-card/60"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span
          className="h-3.5 w-3.5 rounded-full border-2 border-primary/70 border-t-transparent animate-spin shrink-0"
          aria-hidden
        />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">
            Keresés: <span className="text-muted-foreground">„{query}”</span>
          </div>
          <div
            key={line}
            className="text-xs text-muted-foreground mt-0.5 transition-opacity duration-500"
            style={{ animation: "search-stage-fade 400ms ease-out both" }}
          >
            {line}
          </div>
        </div>
      </div>

      {/* Desktop-only subtle skeletons. On mobile we keep it to one line so the
          results don't get pushed far down — per UX spec. */}
      <div className="hidden sm:block mt-5 space-y-2">
        <div className="h-12 rounded-md bg-muted/50 animate-pulse" />
        <div className="h-12 rounded-md bg-muted/35 animate-pulse" />
        <div className="h-12 rounded-md bg-muted/25 animate-pulse" />
      </div>
    </div>
  );
}
