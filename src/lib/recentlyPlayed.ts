// LocalStorage-based "Continue listening" / recently visited episodes.
// Keys an episode by its podcast_slug + episode_slug pair so it survives reloads.

const KEY = "podiverzum:recent-episodes:v1";
const MAX = 8;

export type RecentEpisode = {
  podcastSlug: string;
  episodeSlug: string;
  title: string;
  podcastTitle: string;
  imageUrl?: string | null;
  visitedAt: number;
};

function read(): RecentEpisode[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => x && x.podcastSlug && x.episodeSlug) : [];
  } catch {
    return [];
  }
}

function write(items: RecentEpisode[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {
    /* quota or private mode */
  }
}

export function recordVisit(input: Omit<RecentEpisode, "visitedAt">) {
  const items = read().filter(
    (x) => !(x.podcastSlug === input.podcastSlug && x.episodeSlug === input.episodeSlug),
  );
  items.unshift({ ...input, visitedAt: Date.now() });
  write(items);
}

export function getRecentEpisodes(): RecentEpisode[] {
  return read();
}

export function clearRecentEpisodes() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY);
}
