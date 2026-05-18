// Phase 2 stub — hidden by feature flag, no UI in Phase 1.
import { useSmartPlayer } from "./SmartPlayerProvider";

export function TasteFeedbackButtons({ episodeId }: { episodeId: string }) {
  const { flags } = useSmartPlayer();
  if (!flags.show_taste_buttons) return null;

  const record = (verdict: "more" | "not_for_me" | "later") => {
    try {
      const k = "podiverzum_taste_events";
      const list = JSON.parse(localStorage.getItem(k) || "[]");
      list.push({ episodeId, verdict, t: Date.now() });
      localStorage.setItem(k, JSON.stringify(list.slice(-500)));
    } catch { /* noop */ }
  };

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      <button onClick={() => record("more")} className="text-xs px-2.5 py-1 rounded-full border border-border hover:bg-secondary">Több ilyet</button>
      <button onClick={() => record("not_for_me")} className="text-xs px-2.5 py-1 rounded-full border border-border hover:bg-secondary">Nem nekem való</button>
      <button onClick={() => record("later")} className="text-xs px-2.5 py-1 rounded-full border border-border hover:bg-secondary">Későbbre</button>
    </div>
  );
}
