import type { EpisodeLite } from "@/components/EpisodeCard";
import { entitySlug, type EntityKind } from "./entity";

export type EntityCount = { kind: EntityKind; value: string; slug: string; count: number };

const STOP = new Set([
  "the","a","an","and","or","of","to","for","on","in","with","podcast","episode","show",
]);

function norm(v: string) {
  return v.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function topEntitiesFrom(
  episodes: EpisodeLite[],
  field: "topics" | "people" | "companies" | "tickers" | "ingredients",
  kind: EntityKind,
  limit = 10,
  options?: { excludeHosts?: boolean; blocklist?: string[] },
): EntityCount[] {
  const tally = new Map<string, EntityCount>();
  const blockSet = new Set((options?.blocklist || []).map(norm));
  for (const e of episodes) {
    const arr = (e as any)[field] as string[] | null | undefined;
    if (!Array.isArray(arr)) continue;
    // Per-episode host exclusion (only meaningful for the "people" field)
    const epHosts = new Set<string>();
    if (options?.excludeHosts && field === "people") {
      const hosts = (e as any)?.podcasts?.hosts as string[] | null | undefined;
      if (Array.isArray(hosts)) for (const h of hosts) if (h) epHosts.add(norm(h));
    }
    for (const raw of arr) {
      if (!raw || typeof raw !== "string") continue;
      const v = raw.trim();
      if (!v || v.length < 2) continue;
      const key = norm(v);
      if (STOP.has(key)) continue;
      if (blockSet.has(key)) continue;
      if (epHosts.has(key)) continue;
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
