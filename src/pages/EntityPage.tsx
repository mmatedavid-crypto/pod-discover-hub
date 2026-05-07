import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { setSeo } from "@/lib/seo";
import NotFoundState from "@/components/NotFoundState";
import { ENTITY_COLUMN, ENTITY_LABEL, EntityKind, matchesEntitySlug } from "@/lib/entity";

const NOINDEX_BELOW = 5;
const RICH_AT = 20;

export default function EntityPage({ kind }: { kind: EntityKind }) {
  const { slug = "" } = useParams();
  const decoded = useMemo(() => decodeURIComponent(slug), [slug]);
  const [eps, setEps] = useState<EpisodeLite[]>([]);
  const [pods, setPods] = useState<PodcastLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState<string>(decoded);
  const [related, setRelated] = useState<{ kind: EntityKind; v: string; n: number }[]>([]);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      const col = ENTITY_COLUMN[kind];
      const { data: cand } = await supabase
        .from("episodes")
        .select(`id,title,slug,published_at,summary,description,audio_url,episode_rank,topics,people,companies,tickers,ingredients,podcast_id,podcasts!inner(slug,title,display_title,image_url,category,podiverzum_rank,rss_status,featured)`)
        .not(col, "is", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(800);

      const matches: any[] = [];
      let exemplar = decoded;
      (cand || []).forEach((e: any) => {
        const arr: string[] = e[col] || [];
        const hit = arr.find((v) => matchesEntitySlug(kind, v, decoded));
        if (hit) {
          matches.push(e);
          if (exemplar === decoded) exemplar = hit;
        }
      });
      // Filter out broken parent feeds
      const visible = matches.filter((e) => {
        const ps = e.podcasts;
        return ps && ps.rss_status !== "failed" && ps.rss_status !== "inactive";
      });
      setDisplayName(exemplar);

      // Rank/freshness sort + dedupe; latest first secondary sort
      const sorted = visible.slice().sort((a, b) => {
        const ar = a.episode_rank || 0, br = b.episode_rank || 0;
        if (br !== ar) return br - ar;
        return new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime();
      });
      setEps(sorted.slice(0, 40) as any);

      // Related podcasts
      const podMap = new Map<string, any>();
      visible.forEach((e: any) => { if (e.podcasts) podMap.set(e.podcast_id, e.podcasts); });
      const podIds = Array.from(podMap.keys());
      if (podIds.length) {
        const { data: ps } = await supabase
          .from("podcasts")
          .select("id,title,display_title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,rss_status,podiverzum_rank")
          .in("id", podIds);
        const sortedPods = (ps || [])
          .filter((p: any) => p.featured || (p.rss_status !== "failed" && p.rss_status !== "inactive"))
          .sort((a: any, b: any) => (b.podiverzum_rank || 0) - (a.podiverzum_rank || 0))
          .slice(0, 9);
        setPods(sortedPods);
      } else {
        setPods([]);
      }

      // Related entities (co-occurring)
      const co: { kind: EntityKind; v: string; n: number }[] = [];
      const tally = new Map<string, { kind: EntityKind; v: string; n: number }>();
      visible.forEach((e: any) => {
        (Object.keys(ENTITY_COLUMN) as EntityKind[]).forEach((k) => {
          if (k === kind) return;
          const arr: string[] = e[ENTITY_COLUMN[k]] || [];
          arr.forEach((v) => {
            const key = `${k}:${v.toLowerCase()}`;
            const cur = tally.get(key);
            if (cur) cur.n++; else tally.set(key, { kind: k, v, n: 1 });
          });
        });
      });
      tally.forEach((x) => co.push(x));
      setRelated(co.sort((a, b) => b.n - a.n).slice(0, 16));

      setLoading(false);

      const total = visible.length;
      const noindex = total < NOINDEX_BELOW;
      setSeo({
        title: `Podcast episodes about ${exemplar} — Podiverzum`,
        description: `Discover podcast episodes about ${exemplar}, ranked by relevance, freshness and Podiverzum Rank.`,
        noindex,
        jsonLd: noindex ? undefined : {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: `Podcast episodes about ${exemplar}`,
          about: { "@type": ENTITY_LABEL[kind] === "Person" ? "Person" : "Thing", name: exemplar },
        },
      });
    })();
  }, [kind, slug, decoded]);

  if (loading) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;

  if (!eps.length) return (
    <NotFoundState
      title={`No episodes about ${displayName}`}
      message={`Podiverzum hasn't indexed enough podcast episodes about ${displayName} yet. Try the search instead.`}
    />
  );

  const total = eps.length;
  const rich = total >= RICH_AT;
  const newest = eps.slice().sort((a, b) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime()).slice(0, 12);
  const best = eps.slice().sort((a, b) => (b.episode_rank || 0) - (a.episode_rank || 0)).slice(0, 12);

  return (
    <Layout>
      <div className="container mx-auto py-10 max-w-4xl">
        <div className="text-xs uppercase tracking-wide text-accent">{ENTITY_LABEL[kind]}</div>
        <h1 className="text-3xl font-semibold mt-1">Podcast episodes about {displayName}</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {total} episode{total === 1 ? "" : "s"} indexed. Ranked by relevance, freshness and Podiverzum Rank.
        </p>

        <section className="mt-8">
          <h2 className="font-semibold mb-3">Latest episodes</h2>
          <EpisodeList items={newest} showEntities />
        </section>

        {rich && (
          <section className="mt-10">
            <h2 className="font-semibold mb-3">Best ranked episodes</h2>
            <EpisodeList items={best} showEntities />
          </section>
        )}

        {pods.length > 0 && (
          <section className="mt-10">
            <h2 className="font-semibold mb-3">Related podcasts</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pods.map((p) => <PodcastCard key={p.id} p={p} />)}
            </div>
          </section>
        )}

        {related.length > 0 && (
          <section className="mt-10">
            <h2 className="font-semibold mb-3">Related</h2>
            <div className="flex flex-wrap gap-2">
              {related.map(({ kind: k, v }) => {
                const s = k === "ticker" ? v.replace(/[^a-zA-Z0-9.]+/g,"").toUpperCase() : v.toLowerCase().replace(/[^a-z0-9]+/g,"-");
                return (
                  <Link key={`${k}-${v}`} to={`/${k}/${encodeURIComponent(s)}`} className="px-3 py-1 rounded-full bg-secondary text-sm hover:bg-accent hover:text-accent-foreground">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">{k}</span>{v}
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <p className="text-xs text-muted-foreground mt-10">
          Indexed from public RSS feeds. Ranked by freshness, feed health and episode relevance.
        </p>
      </div>
    </Layout>
  );
}
