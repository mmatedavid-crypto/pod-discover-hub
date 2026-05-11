import type { EpisodeLite } from "@/components/EpisodeCard";
import { entitySlug, type EntityKind } from "./entity";

export type EntityCount = { kind: EntityKind; value: string; slug: string; count: number };

const STOP = new Set([
  "the","a","an","and","or","of","to","for","on","in","with","podcast","episode","show",
]);

function norm(v: string) {
  return v.trim().toLowerCase();
}

export function topEntitiesFrom(
  episodes: EpisodeLite[],
  field: "topics" | "people" | "companies" | "tickers" | "ingredients",
  kind: EntityKind,
  limit = 10,
): EntityCount[] {
  const tally = new Map<string, EntityCount>();
  for (const e of episodes) {
    const arr = (e as any)[field] as string[] | null | undefined;
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      if (!raw || typeof raw !== "string") continue;
      const v = raw.trim();
      if (!v || v.length < 2) continue;
      if (STOP.has(norm(v))) continue;
      const key = norm(v);
      const cur = tally.get(key);
      if (cur) cur.count++;
      else tally.set(key, { kind, value: v, slug: entitySlug(kind, v), count: 1 });
    }
  }
  return Array.from(tally.values())
    .filter((x) => x.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
