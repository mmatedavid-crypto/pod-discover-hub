import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { setSeo } from "@/lib/seo";
import NotFoundState from "@/components/NotFoundState";
import { ENTITY_COLUMN, ENTITY_LABEL, EntityKind, matchesEntitySlug } from "@/lib/entity";
import { compareByScore, episodeScore } from "@/lib/episodeRank";

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
        .select(`id,title,slug,published_at,summary,description,audio_url,topics,people,companies,tickers,ingredients,podcast_id,podcasts!inner(slug,title,display_title,image_url,category,podiverzum_rank,rank_label,rss_status,featured)`)
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

      // Composite tier+freshness sort; latest first secondary
      const sorted = visible.slice().sort(compareByScore);
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
      const entityType =
        kind === "person" ? "Person" :
        kind === "company" ? "Organization" :
        kind === "ticker" ? "Corporation" :
        "Thing";
      const pageUrl = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
      setSeo({
        title: `Podcast episodes about ${exemplar} — Podiverzum`,
        description: `Discover podcast episodes about ${exemplar}, ranked by relevance, freshness and Podiverzum Rank.`,
        noindex,
        jsonLd: noindex ? undefined : [
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: `Podcast episodes about ${exemplar}`,
            url: pageUrl || undefined,
            about: { "@type": entityType, name: exemplar },
          },
          {
            "@context": "https://schema.org",
            "@type": entityType,
            name: exemplar,
            url: pageUrl || undefined,
          },
        ],
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
  const best = eps.slice().sort((a, b) => episodeScore(b) - episodeScore(a)).slice(0, 12);

  const last30Count = eps.filter((e) => {
    if (!e.published_at) return false;
    return Date.now() - new Date(e.published_at).getTime() < 30 * 86400_000;
  }).length;

  return (
    <Layout>
      {/* Hero */}
      <section className="border-b border-border bg-background relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 hero-spot opacity-50" />
        <div className="container mx-auto py-12 sm:py-14 max-w-5xl relative">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">{ENTITY_LABEL[kind]}</div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mt-2 leading-[1.05]">{displayName}</h1>
          <p className="text-muted-foreground mt-3 max-w-2xl">
            Cross-show podcast coverage of <span className="text-foreground font-medium">{displayName}</span>. Ranked by tier, freshness and Podiverzum Rank.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Stat label="Episodes indexed" value={total} />
            <Stat label="Last 30 days" value={last30Count} />
            <Stat label="Podcasts" value={pods.length} />
          </div>
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl space-y-12">
        <section>
          <div className="flex items-end justify-between mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">Fresh</div>
              <h2 className="text-xl font-semibold">Latest episodes</h2>
            </div>
          </div>
          <EpisodeList items={newest} showEntities />
        </section>

        {rich && (
          <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card/40 to-card/40 p-5 sm:p-6">
            <div className="mb-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-primary/90 mb-1">Best of</div>
              <h2 className="text-xl font-semibold">Highest-ranked episodes</h2>
              <p className="text-xs text-muted-foreground mt-1">From S/A-tier shows that consistently deliver.</p>
            </div>
            <EpisodeList items={best} showEntities />
          </section>
        )}

        {pods.length > 0 && (
          <section>
            <div className="mb-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">Sources</div>
              <h2 className="text-xl font-semibold">Podcasts covering {displayName}</h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pods.map((p) => <PodcastCard key={p.id} p={p} />)}
            </div>
          </section>
        )}

        {related.length > 0 && (
          <section>
            <div className="mb-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">Connected</div>
              <h2 className="text-xl font-semibold">Related</h2>
              <p className="text-xs text-muted-foreground mt-1">People, companies and topics that show up alongside {displayName}.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {related.map(({ kind: k, v }) => {
                const s = k === "ticker" ? v.replace(/[^a-zA-Z0-9.]+/g,"").toUpperCase() : v.toLowerCase().replace(/[^a-z0-9]+/g,"-");
                return (
                  <Link
                    key={`${k}-${v}`}
                    to={`/${k}/${encodeURIComponent(s)}`}
                    className="px-3 py-1.5 rounded-full border border-border bg-card text-sm hover:border-primary/50 hover:bg-primary/10 hover:text-foreground transition-colors inline-flex items-center gap-1.5"
                  >
                    <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{k}</span>
                    <span>{v}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <p className="text-xs text-muted-foreground pt-4 border-t border-border/60">
          Indexed from public RSS feeds. Ranked by freshness, feed health and episode relevance.
        </p>
      </div>
    </Layout>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card/70 px-4 py-2.5 min-w-[110px]">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

