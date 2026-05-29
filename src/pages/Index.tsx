import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { Search, ArrowRight, Sparkles, Mic, User, Hash, Folder, Building2 } from "lucide-react";
import { setSeo } from "@/lib/seo";
// Homepage-local editorial scoring (does NOT touch lib/episodeRank used elsewhere).
//
// Goal (post HU_v1 cutover): popular/strong shows (S/A + high podiverzum_rank)
// stay eligible longer; freshness still matters but does not dominate; news
// stays eligible but mildly downweighted; short bulletin/segment feeds get a
// stronger penalty and a hard cap in the top rail. No blacklists.
const NEWS_HINTS = [
  "hírek", "hírösszefoglaló", "hír összefoglaló",
  "napi hír", "esti hír", "reggeli hír",
  "krónika", "infostart",
  "rádió hírek", "radio hirek",
  "hírpercek", "hírműsor",
];
function isNewsLikeEpisode(ep: any): boolean {
  const hay = [
    ep?.podcasts?.category,
    ep?.podcasts?.title,
    ep?.podcasts?.display_title,
    ep?.title,
    ep?.display_title,
  ].filter(Boolean).join(" ").toLowerCase();
  return NEWS_HINTS.some((h) => hay.includes(h));
}
// Detect short bulletin / segment / breakout feeds:
//   "1 - …", "02 - …", "20260529 - 08 Voga rovata", "Hírek röviden",
//   "6 óra", "8 perc hírek", standalone "Bochkor: 03 …", etc.
// These are typically <5 min cut-down segments that flood "Felkapott" if not
// downweighted. We never reject the feed — just lower its homepage weight.
const BULLETIN_HINTS = [
  "hírek röviden", "röviden a hírek", "hírek 5 perc", "5 perc hír",
  "percben", "perc hír", "perc hírek", "hírek dióhéjban",
];
function isBulletinLikeEpisode(ep: any): boolean {
  const rawTitle = String(ep?.display_title || ep?.title || "").trim();
  if (!rawTitle) return false;
  const t = rawTitle.toLowerCase();
  if (BULLETIN_HINTS.some((h) => t.includes(h))) return true;
  // Numeric segment prefixes: "1 - …", "02 - …", "07 Hangcsapda háték"
  if (/^\s*\d{1,2}\s*[-–—]\s+\S/.test(rawTitle)) return true;
  // Date-prefixed segments: "20260529 - 02 Ma mi nyűgöz le", "2026 05 29 …"
  if (/^\s*(20\d{6}|20\d{2}[\s._-]?\d{2}[\s._-]?\d{2})\s*[-–—\s]/.test(rawTitle)) return true;
  // "N óra" / "N perc" mini-bulletin titles ("6 óra", "8 perc hírek")
  if (/^\s*\d{1,2}\s+(óra|perc)\b/.test(t)) return true;
  return false;
}
function tierDecayHours(label: string | null | undefined): number {
  switch (label) {
    case "S": return 14 * 24;
    case "A": return 10 * 24;
    case "B": return 7 * 24;
    case "C": return 4 * 24;
    default:  return 2 * 24; // D, E, null
  }
}
function homepageScore(ep: any): number {
  const label = ep?.podcasts?.rank_label as string | undefined;
  const tier =
    label === "S" ? 100 :
    label === "A" ? 75 :
    label === "B" ? 45 :
    label === "C" ? 25 :
    (label === "D" || label === "E") ? 8 : 12;

  const featured = !!ep?.podcasts?.featured;
  const fb = featured ? 25 : 0;
  const fr = Number(ep?.podcasts?.featured_rank);
  const featuredRankBonus = featured && Number.isFinite(fr)
    ? Math.max(0, 12 - Math.min(12, fr)) : 0;

  // HU_v1 score lives in podiverzum_rank (0–10). Weight 3 per point → up to +30.
  const pvr = Math.min(Math.max(Number(ep?.podcasts?.podiverzum_rank) || 0, 0), 10);
  const rankBoost = pvr * 3;

  // Tier-aware freshness: stronger shows decay slower.
  let fresh = 0;
  const t = ep?.published_at ? new Date(ep.published_at).getTime() : NaN;
  if (Number.isFinite(t)) {
    const ageH = Math.max(0, (Date.now() - t) / 3600_000);
    if (ageH < 24) fresh = 30; // <24h: strong recency boost regardless of tier
    else {
      const decay = tierDecayHours(label);
      const remaining = Math.max(0, 1 - (ageH - 24) / Math.max(1, decay - 24));
      fresh = Math.round(22 * remaining);
    }
  }

  const news = isNewsLikeEpisode(ep);
  const bulletin = isBulletinLikeEpisode(ep);
  const penalty = (bulletin ? 35 : 0) + (news ? 12 : 0);

  return tier + fb + featuredRankBonus + rankBoost + fresh - penalty;
}
function compareByHomepageScore(a: any, b: any): number {
  const sb = homepageScore(b), sa = homepageScore(a);
  if (sb !== sa) return sb - sa;
  const at = a.published_at ? new Date(a.published_at).getTime() : 0;
  const bt = b.published_at ? new Date(b.published_at).getTime() : 0;
  return bt - at;
}
import { MoodCollections } from "@/components/MoodCollections";
import { Skeleton } from "@/components/Skeletons";
import { ContinueListening } from "@/components/ContinueListening";
import { RecentlyAddedPodcasts } from "@/components/RecentlyAddedPodcasts";
import { TrendingEntities } from "@/components/TrendingEntities";
import { TrendingPodcasts } from "@/components/TrendingPodcasts";
import { MyLibraryRails } from "@/components/home/MyLibraryRails";
import { PersonalizedHomeRails } from "@/components/home/PersonalizedHomeRails";
import { HomeTopicsSection } from "@/components/HomeTopicsSection";
import { topEntitiesFrom } from "@/lib/aggregateEntities";
import { useSearchSuggestions, computeGhost, GhostSuggestion } from "@/lib/useSearchGhost";

const SUGG_ICON: Record<GhostSuggestion["type"], any> = {
  podcast: Mic,
  person: User,
  topic: Hash,
  category: Folder,
  organization: Building2,
  query: Search,
};



type Category = { id: string; name: string; slug: string; description: string | null };

const HOMEPAGE_EPISODE_LIMIT = 240;

type FeedEpisode = EpisodeLite & { freshness_bucket?: "hot" | "fresh" | "recent" };

const Index = () => {
  const [q, setQ] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [podcasts, setPodcasts] = useState<(PodcastLite & { podiverzum_rank?: number; featured?: boolean })[]>([]);
  const [trendingEps, setTrendingEps] = useState<FeedEpisode[]>([]);
  const [allEps, setAllEps] = useState<FeedEpisode[]>([]);
  const [evergreenEps, setEvergreenEps] = useState<EpisodeLite[]>([]);
  const [trendingEntityEps, setTrendingEntityEps] = useState<EpisodeLite[]>([]);
  const [chipPool, setChipPool] = useState<{ label: string; query: string }[]>([
    { label: "MNB kamatdöntés", query: "MNB kamatdöntés" },
    { label: "magyar gazdaság", query: "magyar gazdaság" },
    { label: "mesterséges intelligencia", query: "mesterséges intelligencia" },
    { label: "Hold Alapkezelő", query: "Hold Alapkezelő" },
    { label: "egészséges életmód", query: "egészséges életmód" },
    { label: "vállalkozói történetek", query: "vállalkozói történetek" },
    { label: "politikai háttér", query: "politikai háttér" },
    { label: "MI szabályozás", query: "MI szabályozás" },
    { label: "tőzsde", query: "tőzsde" },
    { label: "Friderikusz", query: "Friderikusz" },
  ]);
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [heroPlaceholder, setHeroPlaceholder] = useState(
    typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches
      ? "MNB kamatdöntés, mesterséges intelligencia, Hold Alapkezelő…"
      : "Téma vagy gondolat…"
  );
  const nav = useNavigate();
  const heroWrapRef = useRef<HTMLDivElement | null>(null);
  const heroInputRef = useRef<HTMLInputElement | null>(null);
  const [heroOpen, setHeroOpen] = useState(false);
  const [hasSearched, setHasSearched] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("podi:hasSearched") === "1";
  });
  const { suggestions: heroSugg, loading: heroLoadingSugg } = useSearchSuggestions(q, 8);
  const heroGhost = computeGhost(q, heroSugg);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!heroWrapRef.current?.contains(e.target as Node)) setHeroOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const acceptHeroGhost = () => {
    if (!heroGhost) return false;
    const completed = q + heroGhost;
    setQ(completed);
    setHeroOpen(true);
    requestAnimationFrame(() => {
      const el = heroInputRef.current;
      if (el) el.setSelectionRange(completed.length, completed.length);
    });
    return true;
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setHeroPlaceholder(mq.matches ? "MNB kamatdöntés, mesterséges intelligencia, Hold Alapkezelő…" : "Téma vagy gondolat…");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "search_suggestions")
      .maybeSingle()
      .then(({ data }) => {
        const items = (data?.value as any)?.items;
        if (Array.isArray(items) && items.length) {
          const cleaned = items.filter((c: any) => c?.label && c?.query);
          if (cleaned.length >= 4) setChipPool(cleaned);
        }
      });
  }, []);

  // Stable per-week rotation
  const visibleChips = useMemo(() => {
    if (!chipPool.length) return [];
    const week = Math.floor(Date.now() / (7 * 86400_000));
    const offset = week % chipPool.length;
    const n = Math.min(5, chipPool.length);
    return Array.from({ length: n }, (_, i) => chipPool[(offset + i) % chipPool.length]);
  }, [chipPool]);

  useEffect(() => {
    setSeo({
      title: "Podiverzum.hu — Find it. Hear it.",
      description: "Magyar podcast kereső és felfedező. Keress epizódokat téma, személy, szervezet, műsor vagy gondolat alapján.",
      hreflang: [
        { lang: "hu", href: "https://podiverzum.hu/" },
        { lang: "x-default", href: "https://podiverzum.hu/" },
      ],
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Podiverzum",
        url: "https://podiverzum.hu",
        potentialAction: {
          "@type": "SearchAction",
          target: "https://podiverzum.hu/search?q={search_term_string}",
          "query-input": "required name=search_term_string",
        },
      },
    });
    (async () => {
      try {
        const since14d = new Date(Date.now() - 14 * 86400_000).toISOString();
        const [catsRes, feedRes, evergreenRes, podsRes, entityRes] = await Promise.all([
          supabase.from("categories").select("*").order("sort_order"),
          supabase
            .from("mv_homepage_feed" as any)
            .select("episode_id,title,display_title,slug,summary,description,published_at,audio_url,topics,podcast_id,podcast_slug,podcast_title,podcast_display_title,podcast_image_url,podcast_category,podiverzum_rank,rank_label,rss_status,featured,featured_rank,pod_rank,freshness_bucket")
            .lte("pod_rank", 6)
            .order("published_at", { ascending: false, nullsFirst: false })
            .limit(HOMEPAGE_EPISODE_LIMIT),
          supabase
            .from("mv_homepage_evergreen" as any)
            .select("episode_id,title,display_title,slug,summary,description,ai_summary,published_at,audio_url,topics,podcast_id,podcast_slug,podcast_title,podcast_display_title,podcast_image_url,podcast_category,podiverzum_rank,rank_label,rss_status,featured")
            .order("podiverzum_rank", { ascending: false, nullsFirst: false })
            .order("published_at", { ascending: false, nullsFirst: false })
            .limit(120),
          supabase
            .from("podcasts")
            .select("id,title,display_title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,featured_rank,rss_status,podiverzum_rank,rank_label,shadow_rank_components")
            .or("featured.eq.true,rank_label.in.(S,A)")
            .not("rss_status", "in", "(failed,inactive)")
            // HU-only safety gate (strict): must have passed the language gate
            .eq("is_hungarian", true)
            .eq("language_decision", "accept_hungarian")
            .order("featured", { ascending: false })
            .order("podiverzum_rank", { ascending: false })
            .limit(40),
          supabase
            .from("episodes")
            .select("id,topics,people,companies,podcasts!inner(rss_status,language,rank_label,hosts)")
            .gte("published_at", since14d)
            .in("podcasts.rank_label", ["S", "A", "B"])
            .or("is_hungarian.eq.true", { foreignTable: "podcasts" })
            .not("podcasts.rss_status", "in", "(failed,inactive)")
            .limit(1500),
        ]);

        setCats(catsRes.data || []);

        const goodHealth = (p: any) => {
          const hs = (p.shadow_rank_components as any)?.health_state;
          return !hs || hs === "healthy" || hs === "recovered_rss_url";
        };
        const eligible = (podsRes.data || []).filter((p: any) =>
          p.featured || (["S", "A"].includes(p.rank_label) && goodHealth(p))
        );
        setPodcasts(eligible);

        const mapRow = (r: any): FeedEpisode => ({
          id: r.episode_id,
          title: r.title,
          display_title: r.display_title,
          slug: r.slug,
          summary: r.summary,
          description: r.description,
          published_at: r.published_at,
          audio_url: r.audio_url,
          topics: r.topics,
          freshness_bucket: r.freshness_bucket,
          podcasts: {
            slug: r.podcast_slug,
            title: r.podcast_title,
            display_title: r.podcast_display_title,
            image_url: r.podcast_image_url,
            category: r.podcast_category,
            podiverzum_rank: r.podiverzum_rank,
            rank_label: r.rank_label,
            rss_status: r.rss_status,
            featured: r.featured,
          } as any,
        });

        const eps: FeedEpisode[] = (feedRes.data || []).map(mapRow);

        // Trending = last 14 days (hot+fresh). Fall back to recent (≤30d) if <8 items.
        const hotFresh = eps.filter((e) => e.freshness_bucket === "hot" || e.freshness_bucket === "fresh");
        const trendingPool = hotFresh.length >= 8 ? hotFresh : eps;
        // Editorial homepage scoring: tier/featured/rank dominate, freshness softer,
        // news-like episodes soft-penalized (-25). Hard caps: 2 ep/podcast, max 2
        // news in top 8. Backfill from overflow (incl. news) so rail isn't empty.
        const sorted = trendingPool.slice().sort(compareByHomepageScore);
        const PER_PODCAST_CAP = 2;
        const NEWS_TOP_CAP = 2;
        const counts = new Map<string, number>();
        const primary: FeedEpisode[] = [];
        const overflow: FeedEpisode[] = [];
        let newsCount = 0;
        for (const e of sorted) {
          const key = (e.podcasts as any)?.slug || (e.podcasts as any)?.title || "_";
          const n = counts.get(key) || 0;
          const news = isNewsLikeEpisode(e);
          if (n >= PER_PODCAST_CAP) { overflow.push(e); continue; }
          if (news && newsCount >= NEWS_TOP_CAP && primary.length < 8) { overflow.push(e); continue; }
          primary.push(e); counts.set(key, n + 1);
          if (news) newsCount += 1;
        }
        setTrendingEps([...primary, ...overflow].slice(0, 8));
        setAllEps(eps);

        // Evergreen v0: S-tier, AI-summarized, >30 days old. Diverse by podcast (max 1 per show).
        const evergreenAll: EpisodeLite[] = (evergreenRes.data || []).map(mapRow);
        const seenPods = new Set<string>();
        const evergreenDiverse: EpisodeLite[] = [];
        const evergreenSpill: EpisodeLite[] = [];
        for (const e of evergreenAll) {
          const key = (e.podcasts as any)?.slug || (e.podcasts as any)?.title || "_";
          if (!seenPods.has(key)) { seenPods.add(key); evergreenDiverse.push(e); }
          else evergreenSpill.push(e);
        }
        setEvergreenEps([...evergreenDiverse, ...evergreenSpill].slice(0, 6));

        // Trending entities source (last 14 days, EN-only, healthy podcasts)
        setTrendingEntityEps((entityRes.data || []) as any);
      } catch (err) {
        console.error("Index load failed", err);
        setLoadError(true);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const topPodcasts = useMemo(() => podcasts.slice(0, 3), [podcasts]);

  const epsByCat = useMemo(() => {
    const grouped: Record<string, EpisodeLite[]> = {};
    allEps.forEach((e) => {
      const cat = e.podcasts?.category;
      if (!cat) return;
      (grouped[cat] ||= []).push(e);
    });
    Object.keys(grouped).forEach((k) => {
      const sorted = grouped[k].sort(compareByHomepageScore);
      // Same per-podcast cap as trending: max 2 per show within a category strip.
      const counts = new Map<string, number>();
      const primary: EpisodeLite[] = [];
      const overflow: EpisodeLite[] = [];
      for (const e of sorted) {
        const key = (e.podcasts as any)?.slug || (e.podcasts as any)?.title || "_";
        const n = counts.get(key) || 0;
        if (n < 2) { primary.push(e); counts.set(key, n + 1); }
        else overflow.push(e);
      }
      let ordered = [...primary, ...overflow];
      // Mild news downweight: only if news >50% of the rail, demote news below non-news.
      const newsItems = ordered.filter((e) => isNewsLikeEpisode(e));
      if (ordered.length > 0 && newsItems.length * 2 > ordered.length) {
        const nonNews = ordered.filter((e) => !isNewsLikeEpisode(e));
        ordered = [...nonNews, ...newsItems];
      }
      grouped[k] = ordered.slice(0, 6);
    });
    return grouped;
  }, [allEps]);

  return (
    <Layout>
      
      <section className="bg-background text-foreground relative z-30 border-b border-border">
        <div aria-hidden className="absolute inset-0 bg-background" />
        {/* Brand spotlight */}
        <div aria-hidden className="pointer-events-none absolute inset-0 hero-spot" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-background" />
        <div className="relative container mx-auto pt-6 pb-6 sm:pt-6 sm:pb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-card/60 backdrop-blur text-[10px] uppercase tracking-[0.22em] text-muted-foreground shadow-sm animate-fade-up">
            Podcast felfedezés
          </div>
          <h1 className="text-5xl sm:text-7xl font-bold tracking-tight max-w-4xl mt-4 sm:mt-6 leading-[1.02] animate-fade-up">
            Find it. <span className="text-brand-gradient">Hear it.</span>
          </h1>

          <p className="text-foreground/90 mt-4 sm:mt-6 max-w-2xl text-base sm:text-lg leading-relaxed animate-fade-up font-medium">
            Keress úgy, ahogy gondolkodsz: téma, személy, cég, piac, technológia, hangulat vagy gondolat alapján.
          </p>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm sm:text-base leading-relaxed animate-fade-up">
            A Podiverzum az epizódok tartalma alapján mutatja meg, mit érdemes meghallgatni.
          </p>
          <div ref={heroWrapRef} className="mt-6 sm:mt-10 max-w-2xl relative animate-fade-up">
          <form
            onSubmit={(e) => { e.preventDefault(); setHeroOpen(false); if (q.trim()) { try { window.localStorage.setItem("podi:hasSearched", "1"); } catch {} setHasSearched(true); nav(`/kereses?q=${encodeURIComponent(q.trim())}`); } }}
            className="relative focus-brand rounded-2xl transition-shadow"
          >
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground z-10" />
            {heroGhost && (
              <div
                aria-hidden="true"
                className="absolute inset-0 pl-12 pr-24 sm:pr-32 py-3.5 sm:py-4 text-base whitespace-pre overflow-hidden pointer-events-none flex items-center"
              >
                <span className="invisible">{q}</span>
                <span className="text-muted-foreground/50">{heroGhost}</span>
              </div>
            )}
            <input
              ref={heroInputRef}
              value={q}
              onChange={(e) => { setQ(e.target.value); setHeroOpen(true); }}
              onFocus={() => setHeroOpen(true)}
              onKeyDown={(e) => {
                if (!heroGhost) return;
                if (e.key === "Tab" && !e.shiftKey) {
                  e.preventDefault();
                  acceptHeroGhost();
                  return;
                }
                if (e.key === "ArrowRight") {
                  const el = e.currentTarget;
                  if (el.selectionStart === q.length && el.selectionEnd === q.length) {
                    e.preventDefault();
                    acceptHeroGhost();
                  }
                }
              }}
              placeholder={heroPlaceholder}
              aria-label="Keresés"
              aria-autocomplete="list"
              aria-expanded={heroOpen}
              autoComplete="off"
              spellCheck={false}
              className="relative w-full pl-12 pr-24 sm:pr-32 py-3.5 sm:py-4 rounded-2xl bg-card/80 backdrop-blur border border-border focus:border-primary/50 outline-none text-base placeholder:text-muted-foreground/60 shadow-elevated"
            />
            <button className="btn-brand absolute right-2 top-1/2 -translate-y-1/2 px-4 sm:px-5 py-2 rounded-xl text-sm font-semibold">
              Keresés
            </button>
          </form>
          {heroOpen && q.trim().length >= 2 && (heroSugg.length > 0 || heroLoadingSugg) && (
            <div
              role="listbox"
              className="absolute left-0 right-0 mt-2 rounded-xl border border-border bg-popover shadow-lg z-50 max-h-[70vh] overflow-y-auto"
            >
              {heroLoadingSugg && heroSugg.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">Javaslatok…</div>
              )}
              {heroSugg.map((s, i) => {
                const Icon = SUGG_ICON[s.type] || Search;
                return (
                  <button
                    key={`${s.type}:${s.label}:${i}`}
                    type="button"
                    role="option"
                    onMouseDown={(e) => { e.preventDefault(); setHeroOpen(false); setQ(""); nav(s.href); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2.5 border-b border-border/40 last:border-b-0"
                  >
                    {s.image_url ? (
                      <img src={s.image_url} alt="" loading="lazy" className="h-7 w-7 rounded object-cover bg-muted shrink-0" />
                    ) : (
                      <span className="h-7 w-7 rounded bg-muted/60 flex items-center justify-center shrink-0">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.label}</span>
                      {s.subtitle && (
                        <span className="block text-[11px] text-muted-foreground truncate">{s.subtitle}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          </div>
          {!hasSearched && q.length === 0 && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-nowrap sm:items-center sm:gap-2">
              <div className="flex flex-nowrap items-center gap-2 min-w-0">
                {visibleChips.map((c, i) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => nav(`/kereses?q=${encodeURIComponent(c.query)}`)}
                    className={`chip whitespace-nowrap shrink-0 animate-fade-up ${
                      i >= 3 ? "!hidden sm:!inline-flex" : ""
                    } ${i >= 4 ? "sm:!hidden lg:!inline-flex" : ""}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4">
            <Link
              to="/start"
              className="group inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/15 transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              Építsd fel A Te Podiverzumod
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
        {/* bottom rule */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      </section>

      <div className="container mx-auto pt-4 pb-8 sm:pt-4 sm:pb-12 space-y-8 sm:space-y-10">
        
        <MyLibraryRails />
        <PersonalizedHomeRails />
        <ContinueListening />
        {!loaded && trendingEps.length === 0 && (
          <section>
            <Skeleton className="h-6 w-48 mb-4" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3 p-4 border border-border/50 rounded-xl">
                  <Skeleton className="h-16 w-16 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-5/6" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {trendingEps.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Felkapott epizódok</h2>
                <p className="text-xs text-muted-foreground mt-1">Friss epizódok a műsorok között.</p>
              </div>
            </div>
            <EpisodeList items={trendingEps} scrollAlways />
          </section>
        )}

        <TrendingPodcasts />



        <MoodCollections />



        {(() => {
          // HU categories map to one or more English taxonomy buckets via taxonomy_keys.
          // Aggregate episode lists across all mapped keys for each HU tile.
          const itemsForCat = (c: any): EpisodeLite[] => {
            const keys: string[] = Array.isArray(c.taxonomy_keys) && c.taxonomy_keys.length
              ? c.taxonomy_keys
              : [c.name];
            const merged: EpisodeLite[] = [];
            const seen = new Set<string>();
            for (const k of keys) {
              for (const e of (epsByCat[k] || [])) {
                if (seen.has(e.id)) continue;
                seen.add(e.id);
                merged.push(e);
              }
            }
            return merged.slice(0, 6);
          };
          const populated = cats
            .filter((c: any) => c.slug !== "trending" && itemsForCat(c).length > 0)
            .sort((a: any, b: any) => itemsForCat(b).length - itemsForCat(a).length)
            .slice(0, 3);
          return populated.map((c: any) => {
            const items = itemsForCat(c);
            return (
              <section key={c.id}>
                <div className="flex items-end justify-between mb-1">
                  <h2 className="text-xl sm:text-2xl font-semibold">{c.name}</h2>
                  <Link to={`/category/${c.slug}`} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                    Több epizód <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                <p className="text-xs text-muted-foreground mb-4">Válogatás a kategória friss epizódjaiból.</p>
                <EpisodeList items={items} scrollAlways />

              </section>
            );
          });
        })()}

        <HomeTopicsSection />

        <div className="flex justify-center">
          <Link
            to="/kategoriak"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-border bg-card/60 text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            Összes kategória <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {evergreenEps.length > 0 && (
          <section className="sm:rounded-2xl sm:border sm:border-primary/20 sm:bg-gradient-to-br sm:from-primary/5 sm:via-card/40 sm:to-card/40 sm:p-6">
            <div className="flex items-end justify-between mb-4">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary/90 mb-1">
                  <Sparkles className="h-3 w-3" /> Időtálló
                </div>
                <h2 className="text-xl sm:text-2xl font-semibold">Időtálló epizódok</h2>
                <p className="text-xs text-muted-foreground mt-1">Régebbi, de ma is releváns epizódok a legjobb műsorokból.</p>
              </div>
            </div>
            <EpisodeList items={evergreenEps} scrollAlways />

          </section>
        )}

        {topPodcasts.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">Minőség mindenek felett</div>
                <h2 className="text-xl sm:text-2xl font-semibold">Top podcastok</h2>
              </div>
              <Link to="/kategoriak" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                Minden podcast <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {topPodcasts.map((p) => <PodcastCard key={p.id} p={p} />)}
            </div>
          </section>
        )}

        

        {loaded && !trendingEps.length && !topPodcasts.length && (
          <div className="text-center py-20 text-muted-foreground">
            {loadError
              ? "Az epizódok átmenetileg nem érhetők el. Kérlek, nézz vissza később."
              : "A kiemelt epizódok hamarosan megjelennek."}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default Index;