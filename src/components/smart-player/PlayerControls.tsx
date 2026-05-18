import { useSmartPlayer, formatTime } from "./SmartPlayerProvider";
import { t, formatSpeedLabel } from "@/lib/playerLocale";

const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

export function PlayerControls({ compact = false }: { compact?: boolean }) {
  const { isPlaying, toggle, seekBy, playbackRate, setPlaybackRate } = useSmartPlayer();
  return (
    <div className="flex items-center gap-2">
      {!compact && (
        <button
          onClick={() => seekBy(-15)}
          className="px-2 py-1 rounded-md text-xs hover:bg-secondary"
          aria-label={t("back15")}
        >−15s</button>
      )}
      <button
        onClick={toggle}
        className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center"
        aria-label={isPlaying ? t("pause") : t("play")}
      >
        {isPlaying ? "❚❚" : "▶"}
      </button>
      {!compact && (
        <>
          <button
            onClick={() => seekBy(30)}
            className="px-2 py-1 rounded-md text-xs hover:bg-secondary"
            aria-label={t("fwd30")}
          >+30s</button>
          <select
            value={playbackRate}
            onChange={(e) => setPlaybackRate(Number(e.target.value))}
            className="text-xs bg-secondary rounded-md px-1.5 py-1"
            aria-label={t("playbackSpeed")}
          >
            {SPEEDS.map((s) => <option key={s} value={s}>{formatSpeedLabel(s)}</option>)}
          </select>
        </>
      )}
    </div>
  );
}

export function PlayerProgress({ compact = false }: { compact?: boolean }) {
  const { currentTime, duration, seekTo } = useSmartPlayer();
  const hasDuration = isFinite(duration) && duration > 0;
  const pct = hasDuration ? (currentTime / duration) * 100 : 0;
  const durLabel = hasDuration ? formatTime(duration) : "--:--";
  return (
    <div className="flex items-center gap-2 w-full">
      {!compact && <span className="text-[10px] tabular-nums text-muted-foreground w-10 text-right">{formatTime(currentTime)}</span>}
      <input
        type="range"
        min={0}
        max={hasDuration ? Math.max(1, Math.floor(duration)) : 1}
        value={Math.floor(currentTime)}
        onChange={(e) => seekTo(Number(e.target.value))}
        disabled={!hasDuration}
        className="flex-1 h-1 accent-primary disabled:opacity-50"
        aria-label={t("seek")}
        style={{ background: `linear-gradient(to right, hsl(var(--primary)) ${pct}%, hsl(var(--secondary)) ${pct}%)` }}
      />
      {!compact && <span className="text-[10px] tabular-nums text-muted-foreground w-10">{durLabel}</span>}
    </div>
  );
}
