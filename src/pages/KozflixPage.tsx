import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import ListLoadError from "@/components/ListLoadError";
import { setSeo } from "@/lib/seo";
import { mapEpisodeCardRow } from "@/lib/episodeCards";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";
import { optimizedImageUrl } from "@/lib/image";

const CATEGORY_SLUG = "hirek";
const LIMIT = 12;
// Fetch a small margin so rows dropped by the public filters below do not shrink the list.
const FETCH_LIMIT = 24;
const CANONICAL = "https://podiverzum.hu/kozflix";

type Item = {
  id: string;
  href: string;
  title: string;
  show: string;
  date: string;
  dateIso: string;
  summary: string;
  image: string | null;
};

const huDate = (iso: string) =>
  new Date(iso).toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Budapest" });

export default function KozflixPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setSeo({
      title: "Közéleti hírek a Podiverzumon",
      description: "Friss magyar hír- és közéleti podcastepizódok egy helyen, a legújabbak elöl.",
      canonical: CANONICAL,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(false);
      const [{ data, error: rpcError }, { data: overrides }] = await Promise.all([
        supabase.rpc("category_episodes", { _slug: CATEGORY_SLUG, _limit: FETCH_LIMIT } as any),
        supabase.from("episode_category_overrides").select("episode_id, status").eq("category_slug", CATEGORY_SLUG),
      ]);
      if (cancelled) return;
      if (rpcError) { setError(true); setItems([]); return; }
      const rejected = new Set((overrides || []).filter((o: any) => o.status === "rejected").map((o: any) => o.episode_id));
      const list: Item[] = [];
      for (const row of (data || []) as any[]) {
        const e = mapEpisodeCardRow(row);
        const p = e.podcasts;
        if (!e.slug || !p?.slug || !e.published_at || rejected.has(e.id)) continue;
        if (p.rss_status === "failed" || p.rss_status === "inactive") continue;
        const title = e.display_title || e.title || "";
        // Feeds with broken character encoding show replacement characters; keep them off this landing page.
        if (!title || title.includes("\uFFFD")) continue;
        list.push({
          id: e.id,
          href: `/podcast/${p.slug}/${e.slug}`,
          title,
          show: p.display_title || p.title || "",
          date: huDate(e.published_at),
          dateIso: e.published_at,
          summary: sanitizeHungarianPublicText(e.summary),
          image: e.image_url || p.image_url || null,
        });
      }
      list.sort((a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime());
      setItems(list.slice(0, LIMIT));
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  return (
    <Layout>
      <div className="container mx-auto max-w-3xl py-10">
        <h1 className="text-3xl font-semibold">Közéleti hírek a Podiverzumon</h1>
        <p className="mt-3 text-muted-foreground">
          Friss magyar adások a <Link to={`/kategoria/${CATEGORY_SLUG}`} className="underline hover:text-primary">Hírek és Politika</Link> kategóriából, a legújabbak elöl.
        </p>

        <div className="mt-8">
          {items === null ? (
            <div className="text-sm text-muted-foreground">Betöltés…</div>
          ) : error ? (
            <ListLoadError onRetry={() => setReloadKey((k) => k + 1)} />
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">Most nincs megjeleníthető friss adás.</div>
          ) : (
            <ul className="space-y-3">
              {items.map((it) => (
                <li key={it.id}>
                  <Link to={it.href} className="group flex gap-3 rounded-lg border border-border/70 bg-card/80 p-3 transition-colors hover:border-primary/50 sm:gap-4 sm:p-4">
                    {it.image && (
                      <img
                        src={optimizedImageUrl(it.image, { width: 160, height: 160 }) || it.image}
                        alt=""
                        width={80}
                        height={80}
                        loading="lazy"
                        decoding="async"
                        className="h-16 w-16 shrink-0 rounded-md bg-secondary object-cover sm:h-20 sm:w-20"
                      />
                    )}
                    <div className="min-w-0">
                      <h2 className="font-semibold leading-snug group-hover:underline">{it.title}</h2>
                      <div className="mt-1 text-xs text-muted-foreground">
                        <span>{it.show}</span>
                        <span className="mx-1.5 opacity-60">·</span>
                        <time dateTime={it.dateIso}>{it.date}</time>
                      </div>
                      {it.summary && <p className="mt-2 text-sm leading-relaxed text-muted-foreground line-clamp-2">{it.summary}</p>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Layout>
  );
}
