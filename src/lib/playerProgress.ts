// Local-only playback progress persistence. No cookies, no server sync.
const KEY = "podiverzum_player_progress_v1";
const MAX_ENTRIES = 200;

export type ProgressEntry = {
  episodeId: string;
  currentTime: number;
  duration: number;
  lastPlayedAt: number;
  completed: boolean;
  playCount: number;
};

type Store = Record<string, ProgressEntry>;

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}

function writeStore(s: Store) {
  try {
    const entries = Object.values(s).sort((a, b) => b.lastPlayedAt - a.lastPlayedAt).slice(0, MAX_ENTRIES);
    const trimmed: Store = {};
    entries.forEach((e) => { trimmed[e.episodeId] = e; });
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch { /* noop */ }
}

export function getProgress(episodeId: string): ProgressEntry | null {
  return readStore()[episodeId] || null;
}

export function saveProgress(episodeId: string, currentTime: number, duration: number, completed = false) {
  if (!episodeId) return;
  const s = readStore();
  const prev = s[episodeId];
  s[episodeId] = {
    episodeId,
    currentTime: Math.max(0, Math.floor(currentTime)),
    duration: Math.max(0, Math.floor(duration || prev?.duration || 0)),
    lastPlayedAt: Date.now(),
    completed: completed || (duration > 0 && currentTime / duration > 0.95),
    playCount: (prev?.playCount || 0) + (prev ? 0 : 1),
  };
  writeStore(s);
}

export function markPlayCount(episodeId: string) {
  const s = readStore();
  const prev = s[episodeId];
  if (!prev) return;
  prev.playCount = (prev.playCount || 0) + 1;
  s[episodeId] = prev;
  writeStore(s);
}
