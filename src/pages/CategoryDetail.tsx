import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";

// Deprecated category slugs → canonical successor. Client-side redirect (replace)
// stands in for a 301 on the SPA; the CF worker / prerender layer treats Navigate
// replaces as canonical. Sitemap already excludes inactive categories.
const CATEGORY_REDIRECTS: Record<string, string> = {
  eletmod: "egeszseg",        // Életmód → Egészség (fő utód; gasztro/párkapcsolat külön kategória)
  radioszinhaz: "konyvek",    // Rádiószínház → Könyvek & Irodalom
  lifestyle: "egeszseg",
  "radio-theater": "konyvek",
};
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { setSeo, breadcrumbJsonLd } from "@/lib/seo";
import { categoryHeading, categoryIntro, categoryTitle, categoryMetaDescription } from "@/lib/categoryCopy";
import { discoveryCategories, type DiscoveryCategory } from "@/lib/discoveryNavigation";
import NotFoundState from "@/components/NotFoundState";
import ListLoadError from "@/components/ListLoadError";
import { Search } from "lucide-react";
import { searchEpisodes, MATCH_LABEL, SearchScope } from "@/lib/search";
import { entityHref } from "@/lib/entity";
import { compareByScore } from "@/lib/episodeRank";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";

export default function CategoryDetail() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const queryParam = params.get("q") || "";
  const scopeParam = (params.get("scope") as SearchScope) || "category";

  const [cat, setCat] = useState<any>(null);
  const [podcasts, setPodcasts] = useState<PodcastLite[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeLite[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [relatedCategories, setRelatedCategories] = useState<DiscoveryCategory[]>([]);
  // Load failures (e.g. DB statement timeout) must never be rendered as an empty catalog.
  const [episodesError, setEpisodesError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const redirectTo = slug ? CATEGORY_REDIRECTS[slug] : undefined;

  // Search state
  const [q, setQ] = useState(queryParam);
  const [searchLoading, setSearchLoading] = useState(false);
  const [inCat, setInCat] = useState<EpisodeLite[]>([]);
  const [outside, setOutside] = useState<EpisodeLite[]>([]);
  const [allResults, setAllResults] = useState<EpisodeLite[]>([]);
  const [semanticUsed, setSemanticUsed] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  useEffect(() => { setQ(queryParam); }, [queryParam]);

  useEffect(() => {
    let cancelled = false;
    supabase.from("categories").select("name,slug,active").eq("active", true).order("sort_order")
      .then(({ data }) => { if (!cancelled) setRelatedCategories((data || []) as DiscoveryCategory[]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!slug || redirectTo) return;
    (async () => {
      setLoading(true);
      const { data: c } = await supabase.from("categories").select("*").eq("slug", slug).eq("active", true).maybeSingle();
      setCat(c);
      setLoading(false);
      if (!c) return;
      const seoTitle = sanitizeHungarianPublicText(c.seo_title);
      const seoDescription = sanitizeHungarianPublicText(c.seo_description);
      const copyInput = { name: c.name, slug: c.slug, description: sanitizeHungarianPublicText(c.description), seoTitle, seoDescription };
      const canonical = `https://podiverzum.hu/kategoria/${c.slug}`;
      setSeo({
        title: categoryTitle(copyInput),
        description: categoryMetaDescription(copyInput),
        canonical,
        jsonLd: [
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: `${c.name} podcast epizódok`,
            about: { "@type": "Thing", name: c.name },
            url: canonical,
          },
          breadcrumbJsonLd([
            { name: "Kezdőlap", url: "https://podiverzum.hu/" },
            { name: "Kategóriák", url: "https://podiverzum.hu/kategoriak" },
            { name: c.name, url: canonical },
          ]),
        ],
      });
      // HU categories map to one or more English taxonomy buckets via taxonomy_keys.
      // Fall back to the legacy `c.name = podcasts.category` match if the column is empty
      // (so old rows without taxonomy_keys still resolve something).
      const taxKeys: string[] = Array.isArray((c as any).taxonomy_keys) && (c as any).taxonomy_keys.length
        ? (c as any).taxonomy_keys
        : [c.name];
      const { data: ps } = await supabase
        .from("podcasts")
        .select("id,title,display_title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,rss_status,podiverzum_rank,rank_label,shadow_rank_components,language,language_decision")
        .in("category", taxKeys)
        .eq("language_decision", "accept_hungarian")
        .order("featured", { ascending: false })
        .order("podiverzum_rank", { ascending: false })
        .limit(80);
      const goodHealth = (p: any) => {
        const hs = (p.shadow_rank_components as any)?.health_state;
        return !hs || hs === "healthy" || hs === "recovered_rss_url";
      };
      const visible = (ps || []).filter((p: any) =>
        goodHealth(p) &&
        p.rss_status !== "failed" &&
        p.rss_status !== "inactive"
      );
      const ids0 = visible.map((p: any) => p.id);
      const epCountMap: Record<string, number> = {};
      if (ids0.length) {
        // Aggregate in the DB. Pulling one row per episode for up to 80 shows was
        // tens of thousands of rows and regularly hit the 3s statement timeout.
        const { data: ec } = await supabase.rpc("podcast_episode_counts", { _ids: ids0 });
        (ec || []).forEach((r: any) => { epCountMap[r.podcast_id] = Number(r.episode_count) || 0; });
      }
      const high = visible.filter((p: any) => p.featured || (["S", "A"].includes(p.rank_label) && (epCountMap[p.id] || 0) > 0));
      const mid = visible.filter((p: any) => !p.featured && p.rank_label === "B" && (epCountMap[p.id] || 0) > 0);
      const low = visible.filter((p: any) => !p.featured && !["S", "A", "B"].includes(p.rank_label) && (epCountMap[p.id] || 0) > 0);
      const promotedPodcasts = (high.length >= 6 ? high : [...high, ...mid, ...low]).slice(0, 12);
      setPodcasts(promotedPodcasts);

      // Episode discovery must not be gated by the promoted-podcast tier.
      // Rank can order/highlight, but every accepted Hungarian non-spam show in
      // the category should be eligible for the fresh episode list.
      const categoryPodcastIds = visible.map((p: any) => p.id);
      const EPISODE_FIELDS = "id,title,display_title,slug,image_url,ai_summary,summary,published_at,audio_url,topics";
      const [{ data: eps, error: epsError }, { data: overrides }, { data: classifiedRows, error: classifiedError }] = await Promise.all([
        categoryPodcastIds.length
          ? supabase
              .from("episodes")
              .select(`${EPISODE_FIELDS},podcasts!inner(slug,title,display_title,image_url,category,podiverzum_rank,rank_label)`)
              .in("podcast_id", categoryPodcastIds)
              .order("published_at", { ascending: false, nullsFirst: false })
              .limit(120)
          : Promise.resolve({ data: [] as any[], error: null }),
        supabase
          .from("episode_category_overrides")
          .select("episode_id, status")
          .eq("category_slug", slug),
        // `category_episodes` reads the slim episode_cards projection with an
        // index-backed primary/secondary category lookup. The previous embedded
        // `episode_ai_classifications` select seq-scanned 150k rows and 500'd
        // on the 3s statement timeout, which emptied the category episode list.
        supabase.rpc("category_episodes", { _slug: slug, _limit: 120 } as any),

      ]);
      // Only a total failure (nothing loaded at all) counts as an error state.
      if (epsError && classifiedError) {
        setEpisodesError(true);
        return;
      }
      setEpisodesError(false);
      const rejected = new Set((overrides || []).filter((o: any) => o.status === "rejected").map((o: any) => o.episode_id));
      // Merge: prefer episode-level AI classification rows (precision-first),
      // then fall back to podcast-level category episodes for shows without
      // episode-level classification yet. Rejected overrides always hidden.
      const merged = new Map<string, any>();
      for (const c of (classifiedRows || [])) {
        const e: any = (c as any).episodes;
        if (e && !rejected.has(e.id)) merged.set(e.id, e);
      }
      for (const e of (eps || [])) {
        if (e && !rejected.has(e.id) && !merged.has(e.id)) merged.set(e.id, e);
      }
      const merged_list = [...merged.values()];
      const byDate = merged_list
        .slice()
        .sort((a: any, b: any) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime());
      const capPerPodcast = (list: any[], cap: number, take: number) => {
        const seen = new Map<string, number>();
        const out: any[] = [];
        for (const e of list) {
          const pid = e.podcast_id || e.podcasts?.slug || "_";
          const n = seen.get(pid) || 0;
          if (n >= cap) continue;
          seen.set(pid, n + 1);
          out.push(e);
          if (out.length >= take) break;
        }
        return out;
      };
      const sorted = capPerPodcast(byDate, 2, 25);
      setEpisodes(sorted as any);
      const t = new Map<string, number>();
      (sorted || []).forEach((e: any) => (e.topics || []).forEach((x: string) => t.set(x, (t.get(x) || 0) + 1)));
      setTopics([...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k));
    })();
  }, [slug, reloadKey]);

  // Run query-time search when there is a query.
  useEffect(() => {
    if (!cat || !queryParam) {
      setInCat([]); setOutside([]); setAllResults([]); setSemanticUsed(false); setSuggestion(null);
      return;
    }
    setSearchLoading(true);
    (async () => {
      const categoryKeys: string[] = Array.isArray(cat.taxonomy_keys) && cat.taxonomy_keys.length
        ? cat.taxonomy_keys
        : [cat.name];
      const r = await searchEpisodes({ rawQuery: queryParam, scope: scopeParam, categoryName: cat.name, categoryKeys, limit: 60 });
      setSemanticUsed(r.semanticUsed);
      setSuggestion(r.suggestion);
      const decorate = (arr: any[]) => arr.map((x) => ({ ...x.e, matchBadge: MATCH_LABEL[x.matchType] || "találat" })) as EpisodeLite[];
      setInCat(decorate(r.inCategory));
      setOutside(decorate(r.outsideCategory));
      setAllResults(decorate(r.all));
      setSearchLoading(false);
    })();
  }, [cat, queryParam, scopeParam]);

  const flatTerms = useMemo(() => queryParam.trim().split(/\s+/).filter((t) => t.length >= 2), [queryParam]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (q.trim()) next.set("q", q.trim()); else next.delete("q");
    if (!next.has("scope")) next.set("scope", "category");
    setParams(next);
  };
  const setScope = (s: SearchScope) => {
    const next = new URLSearchParams(params);
    next.set("scope", s);
    if (queryParam) next.set("q", queryParam);
    setParams(next);
  };

  if (redirectTo) return <Navigate to={`/kategoria/${redirectTo}`} replace />;
  if (loading) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Betöltés…</div></Layout>;
  if (!cat) return <NotFoundState title="Nincs ilyen kategória" message="Ez a kategória nem létezik vagy eltávolították." />;

  return (
    <Layout>
      <div className="container mx-auto py-10">
        <nav aria-label="Morzsamenü" className="mb-4 flex flex-wrap gap-2 text-sm text-muted-foreground">
          <Link to="/" className="hover:underline">Kezdőlap</Link><span aria-hidden="true">/</span>
          <Link to="/kategoriak" className="hover:underline">Kategóriák</Link><span aria-hidden="true">/</span>
          <span aria-current="page">{cat.name}</span>
        </nav>
        <h1 className="text-3xl font-semibold">{categoryHeading(cat)}</h1>
        <p className="mt-3 max-w-3xl leading-relaxed text-muted-foreground">
          {categoryIntro({ name: cat.name, slug: cat.slug, description: sanitizeHungarianPublicText(cat.description) })}
        </p>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Válogass a műsorok és a friss epizódok között, vagy keress a kategórián belül.</p>
        <nav aria-label="További podcast kategóriák" className="mt-4 flex flex-wrap gap-2">
          {discoveryCategories(relatedCategories, cat.slug).map((c) => (
            <Link key={c.slug} to={`/kategoria/${c.slug}`} className="rounded-full border border-border px-3 py-2 text-sm hover:text-primary">{c.name}</Link>
          ))}
        </nav>

        {/* Category-scoped search */}
        <form onSubmit={submitSearch} className="relative max-w-2xl mt-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Keresés ${cat.name} epizódok között…`}
            className="w-full pl-10 pr-24 py-3 rounded-md bg-card border border-border focus:border-accent outline-none"
          />
          <button className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm">
            Keresés
          </button>
        </form>
        <div className="flex flex-wrap gap-2 items-center mt-3 text-xs">
          <span className="text-muted-foreground">Keresés köre:</span>
          {([["category", `Ebben a kategóriában`], ["all", "Az egész Podiverzumban"]] as const).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setScope(k)}
              className={`px-2.5 py-1 rounded-full border ${scopeParam === k ? "bg-foreground text-background border-foreground" : "bg-card border-border hover:border-foreground/40"}`}
            >
              {l}
            </button>
          ))}
        </div>

        {queryParam ? (
          <div className="mt-8 space-y-10">
            {searchLoading && <div className="text-sm text-muted-foreground">Keresés…</div>}

            {scopeParam === "category" && (
              <>
                <section>
                  <h2 className="font-semibold mb-3 flex items-center gap-2 flex-wrap">
                    Találatok a kategórián belül ({inCat.length})
                    {suggestion && suggestion.toLowerCase() !== queryParam.toLowerCase() && (
                      <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                        Találatok erre: {suggestion}
                      </span>
                    )}
                    {semanticUsed && (
                      <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-primary/10 border border-primary/30 text-foreground/70">
                        jelentés alapján is
                      </span>
                    )}
                  </h2>
                  {inCat.length > 0 ? (
                    <EpisodeList items={inCat} terms={flatTerms} showEntities />
                  ) : (
                    <div className="p-6 border border-border rounded-lg bg-card text-sm text-muted-foreground">
                      Nincs találat ebben a kategóriában. Próbálj keresni az egész Podiverzumban.
                    </div>
                  )}
                </section>
                {outside.length > 0 && (
                  <section>
                    <h2 className="font-semibold mb-3 flex items-center gap-2 flex-wrap">
                      Találatok más kategóriákból ({outside.length})
                      <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                        kategórián kívül
                      </span>
                    </h2>
                    <EpisodeList items={outside} terms={flatTerms} showEntities />
                  </section>
                )}
              </>
            )}

            {scopeParam === "all" && (
              <section>
                <h2 className="font-semibold mb-3 flex items-center gap-2 flex-wrap">
                  Találatok ({allResults.length})
                  {suggestion && suggestion.toLowerCase() !== queryParam.toLowerCase() && (
                    <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                      Találatok erre: {suggestion}
                    </span>
                  )}
                  {semanticUsed && (
                    <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-primary/10 border border-primary/30 text-foreground/70">
                      jelentés alapján is
                    </span>
                  )}
                </h2>
                <EpisodeList items={allResults} terms={flatTerms} showEntities />
              </section>
            )}
          </div>
        ) : (
          <>
            <h2 className="text-xl font-semibold mt-10 mb-4">Friss epizódok — {cat.name}</h2>
            {episodes.length > 0 ? (
              <EpisodeList items={episodes} showTopics />
            ) : episodesError ? (
              <ListLoadError onRetry={() => setReloadKey((k) => k + 1)} />
            ) : (
              <div className="p-6 border border-border rounded-lg bg-card text-sm text-muted-foreground">
                Ebben a kategóriában még nincsenek podcast epizódok. A Podiverzum folyamatosan bővül.
              </div>
            )}

            {topics.length > 0 && (
              <>
                <h2 className="text-xl font-semibold mt-10 mb-3">Népszerű témák</h2>
                <div className="flex flex-wrap gap-2">
                  {topics.map((t) => (
                    <Link key={t} to={entityHref("topic", t)} rel="nofollow" className="px-3 py-1 rounded-full bg-secondary text-sm hover:bg-accent hover:text-accent-foreground">
                      {t}
                    </Link>
                  ))}
                </div>
              </>
            )}

            {podcasts.length > 0 && (
              <>
                <h2 className="text-xl font-semibold mt-10 mb-4">Kiemelt podcastok — {cat.name}</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {podcasts.map((p) => <PodcastCard key={p.id} p={p} />)}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
