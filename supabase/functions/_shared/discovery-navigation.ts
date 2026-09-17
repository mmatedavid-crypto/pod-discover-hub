/** Shared visitor-facing copy and crawlable discovery destinations. */
export const HOME_INTRO = "Keress úgy, ahogy gondolkodsz: téma, személy, műsor, hangulat vagy gondolat alapján.";
export const HOME_DESCRIPTION = "A Podiverzum az epizódok tartalma alapján mutatja meg, mit érdemes meghallgatni.";
export const CATEGORY_HUB_INTRO = "Válassz egy kategóriát, majd böngéssz a műsorok és a friss epizódok között. Ha konkrét kérdés érdekel, a kategórián belül is kereshetsz.";
export const DISCOVERY_LINKS = [
  { href: "/toplista", label: "Toplistás műsorok" },
  { href: "/kategoriak", label: "Podcast kategóriák" },
  { href: "/temak", label: "Témák" },
  { href: "/szemelyek", label: "Személyek" },
] as const;

export type DiscoveryCategory = { name: string; slug: string; active?: boolean };

/** Curated order only; never create a destination absent from live categories. */
export function discoveryCategories<T extends DiscoveryCategory>(rows: T[], exclude?: string): T[] {
  const priorities = ["tech", "true-crime", "tortenelem", "uzlet", "onfejlesztes", "gyerek"];
  const active = rows.filter((c) => c.active !== false && c.slug !== exclude && /^[a-z0-9-]+$/.test(c.slug));
  const seen = new Set<string>();
  return [
    ...priorities.flatMap((slug) => active.filter((c) => c.slug === slug)),
    ...active,
  ].filter((c) => {
    if (seen.has(c.slug)) return false;
    seen.add(c.slug);
    return true;
  }).slice(0, 6);
}
