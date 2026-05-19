import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { setSeo } from "@/lib/seo";
import NotFoundState from "@/components/NotFoundState";
import { ENTITY_COLUMN, ENTITY_LABEL, EntityKind, entitySlug, matchesEntitySlug } from "@/lib/entity";
import { compareByScore, episodeScore } from "@/lib/episodeRank";

const NOINDEX_BELOW = 5;
const RICH_AT = 20;

interface EntityProfile {
  slug: string;
  display_name: string;
  bio?: string | null;
  episodes_summary?: string | null;
  featured_episode_ids?: string[] | null;
  appearance_stats?: any;
}

export default function EntityPage({ kind }: { kind: EntityKind }) {
  const { slug = "" } = useParams();
  const decoded = useMemo(() => decodeURIComponent(slug), [slug]);
  const [eps, setEps] = useState<EpisodeLite[]>([]);
  const [mentionedEps, setMentionedEps] = useState<EpisodeLite[]>([]);
  const [pods, setPods] = useState<PodcastLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState<string>(decoded);
  const [profile, setProfile] = useState<EntityProfile | null>(null);
  const [related, setRelated] = useState<{ kind: EntityKind; v: string; n: number }[]>([]);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      const col = ENTITY_COLUMN[kind];

      // Curated profile (only meaningful for kind=person at the moment, but harmless to look up)
      let prof: EntityProfile | null = null;
      if (kind === "person") {
        const { data: pr } = await supabase
          .from("entity_profiles")
          .select("slug, display_name, bio, episodes_summary, featured_episode_ids, appearance_stats")
          .eq("kind", "person")
          .eq("slug", entitySlug("person", decoded))
          .maybeSingle();
        if (pr) prof = pr as any;
        setProfile(prof);
      } else {
        setProfile(null);
      }

      // Pull recent candidates: select both `people` and `mentioned` arrays so we
      // can distinguish speakers from talked-about persons.
      const selectCols = `id,title,slug,published_at,summary,description,audio_url,topics,people,mentioned,companies,tickers,ingredients,podcast_id,podcasts!inner(slug,title,display_title,image_url,category,podiverzum_rank,rank_label,rss_status,featured)`;
      const { data: cand } = await supabase
        .from("episodes")
        .select(selectCols)
        .or(kind === "person" ? `${col}.not.is.null,mentioned.not.is.null` : `${col}.not.is.null`)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(800);

      const speakerMatches: any[] = [];
      const mentionedMatches: any[] = [];
      let exemplar = prof?.display_name || decoded;
      (cand || []).forEach((e: any) => {
        const peopleArr: string[] = e[col] || [];
        const hitPeople = peopleArr.find((v) => matchesEntitySlug(kind, v, decoded));
        const mentionedArr: string[] = kind === "person" ? (e.mentioned || []) : [];
        const hitMentioned = mentionedArr.find((v) => matchesEntitySlug(kind, v, decoded));
        if (hitPeople) {
          speakerMatches.push(e);
          if (exemplar === decoded) exemplar = hitPeople;
        } else if (hitMentioned) {
          // Only push to mentioned bucket if NOT already a speaker — speaker wins.
          mentionedMatches.push(e);
          if (exemplar === decoded) exemplar = hitMentioned;
        }
      });
      const filterVisible = (e: any) => {
        const ps = e.podcasts;
        return ps && ps.rss_status !== "failed" && ps.rss_status !== "inactive";
      };
      const visible = speakerMatches.filter(filterVisible);
      const visibleMentioned = mentionedMatches.filter(filterVisible);
      setDisplayName(prof?.display_name || exemplar);

      const sorted = visible.slice().sort(compareByScore);
      setEps(sorted.slice(0, 40) as any);
      const sortedM = visibleMentioned.slice().sort(compareByScore);
      setMentionedEps(sortedM.slice(0, 20) as any);

      // Related podcasts (only from speaker matches — more authoritative)
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

      // Related entities (co-occurring) from speaker matches
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
      const co: { kind: EntityKind; v: string; n: number }[] = [];
      tally.forEach((x) => co.push(x));
      setRelated(co.sort((a, b) => b.n - a.n).slice(0, 16));

      setLoading(false);

      const total = visible.length;
      const noindex = total < NOINDEX_BELOW && !prof; // profile pages always indexable
      const entityType =
        kind === "person" ? "Person" :
        kind === "company" ? "Organization" :
        kind === "ticker" ? "Corporation" :
        "Thing";
      const pageUrl = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
      const finalName = prof?.display_name || exemplar;
      const seoDesc = prof?.bio
        ? prof.bio.split(/\.\s+/)[0].slice(0, 160)
        : `Magyar podcast epizódok ${finalName} témában. A Podiverzum keresője a műsorok minősége, az epizódok frissessége és relevanciája szerint rangsorol.`;
      setSeo({
        title: `${finalName}: podcast epizódok — Podiverzum`,
        description: seoDesc,
        noindex,
        jsonLd: noindex ? undefined : [
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: `Podcast epizódok: ${finalName}`,
            url: pageUrl || undefined,
            about: { "@type": entityType, name: finalName },
          },
          {
            "@context": "https://schema.org",
            "@type": entityType,
            name: finalName,
            description: prof?.bio || undefined,
            url: pageUrl || undefined,
          },
        ],
      });
    })();
  }, [kind, slug, decoded]);

  if (loading) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Betöltés…</div></Layout>;

  if (!eps.length && !mentionedEps.length) return (
    <NotFoundState
      title={`Nincs találat ehhez: ${displayName}`}
      message={`A Podiverzum még nem talált elegendő epizódot ${displayName} témájában. Próbálkozz a keresővel.`}
    />
  );

  const total = eps.length;
  const rich = total >= RICH_AT;
  const newest = eps.slice().sort((a, b) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime()).slice(0, 12);
  const featuredIds = profile?.featured_episode_ids || [];
  const featuredFromProfile = featuredIds.length
    ? featuredIds.map((id) => eps.find((e) => e.id === id)).filter(Boolean) as EpisodeLite[]
    : [];
  const best = featuredFromProfile.length >= 3
    ? featuredFromProfile
    : eps.slice().sort((a, b) => episodeScore(b) - episodeScore(a)).slice(0, 12);

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
          {profile?.bio ? (
            <p className="text-foreground/85 mt-4 max-w-2xl leading-relaxed">{profile.bio}</p>
          ) : (
            <p className="text-muted-foreground mt-3 max-w-2xl">
              Minden magyar podcast epizód, amiben {kind === "person" ? "megszólal" : "szó esik erről"}: <span className="text-foreground font-medium">{displayName}</span>. Minőség, frissesség és relevancia szerint rangsorolva.
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <Stat label={kind === "person" ? "Megszólal" : "Epizódok"} value={total} />
            {kind === "person" && mentionedEps.length > 0 && <Stat label="Említve" value={mentionedEps.length} />}
            <Stat label="Új (30 nap)" value={last30Count} />
            <Stat label="Műsorok" value={pods.length} />
          </div>
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl space-y-12">
        {eps.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">Friss</div>
                <h2 className="text-xl font-semibold">{kind === "person" ? "Legújabb epizódok, ahol megszólal" : "Legújabb epizódok"}</h2>
              </div>
            </div>
            <EpisodeList items={newest} showEntities />
          </section>
        )}

        {rich && (
          <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card/40 to-card/40 p-5 sm:p-6">
            <div className="mb-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-primary/90 mb-1">Legjobbak</div>
              <h2 className="text-xl font-semibold">Kiemelt epizódok</h2>
              <p className="text-xs text-muted-foreground mt-1">
                {featuredFromProfile.length >= 3 ? "Kurált válogatás." : "Válogatás a legmagasabbra értékelt műsorokból."}
              </p>
            </div>
            <EpisodeList items={best} showEntities />
          </section>
        )}

        {pods.length > 0 && (
          <section>
            <div className="mb-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">Források</div>
              <h2 className="text-xl font-semibold">Műsorok, ahol téma: {displayName}</h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pods.map((p) => <PodcastCard key={p.id} p={p} />)}
            </div>
          </section>
        )}

        {kind === "person" && mentionedEps.length > 0 && (
          <section>
            <div className="mb-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">Említve</div>
              <h2 className="text-xl font-semibold">Epizódok, ahol szó esik {displayName}-ról</h2>
              <p className="text-xs text-muted-foreground mt-1">{displayName} nincs jelen ezekben az epizódokban, de említik vagy szó esik róla.</p>
            </div>
            <EpisodeList items={mentionedEps} showEntities />
          </section>
        )}

        {related.length > 0 && (
          <section>
            <div className="mb-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">Kapcsolódó</div>
              <h2 className="text-xl font-semibold">Gyakran együtt említve</h2>
              <p className="text-xs text-muted-foreground mt-1">Személyek, cégek és témák, amik gyakran felbukkannak {displayName} mellett.</p>
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
          Nyilvános RSS-forrásokból indexelve. A rangsor frissesség, relevancia és a műsorok minősége alapján készül.
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
