import { Clock } from "lucide-react";
import { KeyMoment } from "@/lib/keyMoments";

export function KeyMoments({
  moments,
  audioUrl,
  onSeek,
}: {
  moments: KeyMoment[];
  audioUrl?: string | null;
  onSeek?: (sec: number) => void;
}) {
  if (!moments.length) return null;
  return (
    <div className="mt-6 p-4 rounded-lg border border-border bg-card">
      <div className="text-xs uppercase tracking-wide text-accent mb-3 inline-flex items-center gap-1.5">
        <Clock className="h-3 w-3" /> Kulcs pillanatok
      </div>
      <ol className="space-y-1.5">
        {moments.map((m) => {
          const Inner = (
            <>
              <span className="font-mono text-xs text-primary tabular-nums w-16 flex-shrink-0">{m.raw}</span>
              <span className="text-sm text-foreground/90">{m.label}</span>
            </>
          );
          if (onSeek) {
            return (
              <li key={`${m.timeSec}-${m.label}`}>
                <button
                  type="button"
                  onClick={() => onSeek(m.timeSec)}
                  className="flex items-baseline gap-3 w-full text-left hover:bg-secondary/50 rounded px-2 py-1 -mx-2 transition-colors"
                >
                  {Inner}
                </button>
              </li>
            );
          }
          if (audioUrl) {
            const href = `${audioUrl}${audioUrl.includes("#") ? "&" : "#"}t=${m.timeSec}`;
            return (
              <li key={`${m.timeSec}-${m.label}`}>
                <a href={href} target="_blank" rel="noreferrer" className="flex items-baseline gap-3 hover:bg-secondary/50 rounded px-2 py-1 -mx-2 transition-colors">
                  {Inner}
                </a>
              </li>
            );
          }
          return (
            <li key={`${m.timeSec}-${m.label}`} className="flex items-baseline gap-3 px-2 py-1">
              {Inner}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
