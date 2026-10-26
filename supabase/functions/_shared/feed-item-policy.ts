// Feed item selection and duplicate rules for fetch-one (pure, no I/O).
// 2026-10-26 audit: (1) feeds ordered oldest-first lost every new episode because only the first
// N items were read; (2) feeds that give every item the same <link> (show or category page) had
// every new episode treated as a duplicate of the first one. Both froze podcasts silently.
export type PolicyItem = { guid?: string | null; link?: string | null; published?: string | null; title?: string | null };

// Newest first; items without a date keep their feed order after the dated ones.
export function newestFirst<T extends PolicyItem>(items: T[]): T[] {
  return items
    .map((it, i) => ({ it, i, t: it.published ? Date.parse(it.published) : NaN }))
    .sort((a, b) => {
      const ad = Number.isFinite(a.t), bd = Number.isFinite(b.t);
      if (ad && bd) return b.t - a.t || a.i - b.i;
      if (ad !== bd) return ad ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.it);
}

// A link identifies an episode only when the item has no guid and no other item in the same
// feed shares that link; otherwise a shared show page would mark every new item as known.
export function linkIdentifiesItem(item: PolicyItem, linkCounts: Map<string, number>): boolean {
  return !item.guid && !!item.link && (linkCounts.get(item.link) || 0) === 1;
}

export function countLinks(items: PolicyItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) if (it.link) m.set(it.link, (m.get(it.link) || 0) + 1);
  return m;
}
