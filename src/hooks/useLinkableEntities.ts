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

async function resolve(kind: "person" | "company", slugs: string[]) {
  if (!slugs.length) return;
  const table = kind === "person" ? "people" : "organizations";
  const ok = new Set<string>();
  try {
    // gated_episode_count is computed with the target page's own rule (public
    // episode cards, accepted HU podcasts, accepted links). For people we also
    // mirror the person page's hard blocks, otherwise the link would dead-end.
    const cols = kind === "person"
      ? "slug, activation_status, ai_recommended_action, ai_review_status, identity_status"
      : "slug";
    const { data, error } = await (supabase as any)
      .from(table)
      .select(cols)
      .in("slug", slugs)
      .eq("is_public", true)
      .gte("gated_episode_count", 1);
    if (error) throw error;
    (data || []).forEach((r: any) => {
      if (!r?.slug) return;
      if (kind === "person" && (
        r.activation_status === "inactive"
        || ["hide", "reject"].includes(r.ai_recommended_action || "")
        || ["needs_human_review", "duplicate_candidate"].includes(r.ai_review_status || "")
        || r.identity_status === "split_resolved"
      )) return;
      ok.add(r.slug);
    });
    slugs.forEach((s) => cache.set(`${kind}:${s}`, ok.has(s)));
  } catch {
    // On error, fail closed for this render (no dead-end links); allow retry later.
    slugs.forEach((s) => inflight.delete(`${kind}:${s}`));
    return;
  }
  listeners.forEach((l) => l());
}

// All cards on a page share one debounced batch: one query per kind per 40 ms
// window (chunked at 150 slugs), instead of one query per card.
const pending: Record<"person" | "company", Set<string>> = { person: new Set(), company: new Set() };
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    (["person", "company"] as const).forEach((kind) => {
      const all = Array.from(pending[kind]);
      pending[kind].clear();
      for (let i = 0; i < all.length; i += 150) void resolve(kind, all.slice(i, i + 150));
    });
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
