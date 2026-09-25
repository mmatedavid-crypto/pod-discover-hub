import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { entitySlug, type EntityKind } from "@/lib/entity";

/**
 * Single source of truth for "may this entity chip be a link?".
 *
 * Episode/podcast chips are built from raw extracted strings. Many of those
 * strings have no public page (hidden by review, merged, never created), so a
 * naive link leads to a "Nincs találat" dead end. Every chip renderer asks this
 * hook; only slugs that resolve to a public page with ≥1 episode become links.
 * Topics/tickers/ingredients are not checked here (kept as before).
 */
type Key = string; // `${kind}:${slug}`
const cache = new Map<Key, boolean>();
const inflight = new Map<Key, Promise<void>>();
const listeners = new Set<() => void>();

const CHECKED: EntityKind[] = ["person", "company"];

async function resolveBatch(people: string[], organizations: string[]) {
  if (!people.length && !organizations.length) return;
  const requested = [
    ...people.map((slug) => ({ kind: "person" as const, slug })),
    ...organizations.map((slug) => ({ kind: "company" as const, slug })),
  ];
  const ok = new Set<Key>();
  try {
    // One request covers both entity kinds and mirrors each target page's
    // public-content gates in the database.
    const { data, error } = await (supabase as any).rpc("get_linkable_entities", {
      p_people: people,
      p_organizations: organizations,
    });
    if (error) throw error;
    (data || []).forEach((r: any) => {
      if (r?.slug && (r.kind === "person" || r.kind === "company")) ok.add(`${r.kind}:${r.slug}`);
    });
    requested.forEach(({ kind, slug }) => cache.set(`${kind}:${slug}`, ok.has(`${kind}:${slug}`)));
  } catch {
    // On error, fail closed for this render (no dead-end links); allow retry later.
    requested.forEach(({ kind, slug }) => inflight.delete(`${kind}:${slug}`));
    return;
  }
  listeners.forEach((l) => l());
}

// All cards on a page share one debounced batch across both entity kinds.
const pending: Record<"person" | "company", Set<string>> = { person: new Set(), company: new Set() };
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const people = Array.from(pending.person);
    const organizations = Array.from(pending.company);
    pending.person.clear();
    pending.company.clear();
    for (let i = 0; i < Math.max(people.length, organizations.length); i += 150) {
      void resolveBatch(people.slice(i, i + 150), organizations.slice(i, i + 150));
    }
  }, 40);
}


export function useLinkableEntities(items: { kind: string; value: string }[]) {
  const [, force] = useState(0);
  const keys = useMemo(
    () =>
      items
        .filter((i) => CHECKED.includes(i.kind as EntityKind))
        .map((i) => ({ kind: i.kind as "person" | "company", slug: entitySlug(i.kind as EntityKind, i.value) })),
    [items],
  );
  const sig = keys.map((k) => `${k.kind}:${k.slug}`).join("|");

  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    keys.forEach(({ kind, slug }) => {
      const k = `${kind}:${slug}`;
      if (cache.has(k) || inflight.has(k)) return;
      pending[kind].add(slug);
      inflight.set(k, Promise.resolve());
    });
    scheduleFlush();
    return () => { listeners.delete(l); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return (kind: string, value: string): boolean => {
    if (!CHECKED.includes(kind as EntityKind)) return true;
    return cache.get(`${kind}:${entitySlug(kind as EntityKind, value)}`) === true;
  };
}
