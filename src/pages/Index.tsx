import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { Search, ArrowRight, Sparkles, Mic, User, Hash, Folder, Building2, TrendingUp } from "lucide-react";
import { setSeo } from "@/lib/seo";
import { categoryLabel } from "@/lib/categoryLabels";
import { sitePublisherJsonLd } from "@/lib/sitePublisher";
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

function podcastKey(ep: any): string {
  return ep?.podcast_id || ep?.podcasts?.slug || ep?.podcasts?.title || "_";
}

function avoidAdjacentSamePodcast<T>(items: T[]): T[] {
  const remaining = items.slice();
  const out: T[] = [];
  while (remaining.length > 0) {
    const prevKey = out.length ? podcastKey(out[out.length - 1]) : null;
    let idx = remaining.findIndex((item) => podcastKey(item) !== prevKey);
    if (idx < 0) idx = 0;
    out.push(remaining.splice(idx, 1)[0]);
  }
  return out;
}

function diversifyByPodcast<T>(items: T[], take: number, perPodcastCap = 2): T[] {
  const counts = new Map<string, number>();
  const primary: T[] = [];
  const overflow: T[] = [];
  for (const item of items) {
    const key = podcastKey(item);
    const n = counts.get(key) || 0;
    if (n < perPodcastCap) {
      counts.set(key, n + 1);
      primary.push(item);
    } else {
      overflow.push(item);
    }
  }
  return avoidAdjacentSamePodcast([...primary, ...overflow]).slice(0, take);
}
import { Skeleton } from "@/components/Skeletons";
import { auditHomepageRail } from "@/lib/homepageQuality";
import { useSearchSuggestions, computeGhost, GhostSuggestion } from "@/lib/useSearchGhost";
import { imageSrcSet, optimizedImageUrl } from "@/lib/image";

const MoodCollections = lazy(() => import("@/components/MoodCollections").then((m) => ({ default: m.MoodCollections })));
const ContinueListening = lazy(() => import("@/components/ContinueListening").then((m) => ({ default: m.ContinueListening })));
const TrendingPodcasts = lazy(() => import("@/components/TrendingPodcasts").then((m) => ({ default: m.TrendingPodcasts })));
const MyLibraryRails = lazy(() => import("@/components/home/MyLibraryRails").then((m) => ({ default: m.MyLibraryRails })));
const PersonalizedHomeRails = lazy(() => import("@/components/home/PersonalizedHomeRails").then((m) => ({ default: m.PersonalizedHomeRails })));
const HomeDiscoveryShortcuts = lazy(() => import("@/components/home/HomeDiscoveryShortcuts").then((m) => ({ default: m.HomeDiscoveryShortcuts })));
const HeroTrendsStrip = lazy(() => import("@/components/HeroTrendsStrip").then((m) => ({ default: m.HeroTrendsStrip })));
const WeeklyEditorialStrip = lazy(() => import("@/components/WeeklyEditorialStrip"));

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
type HomepageRailRow = Record<string, unknown>;
type HomepageRailsPayload = {
  trending?: HomepageRailRow[];
  evergreen?: HomepageRailRow[];
  categories?: Record<string, HomepageRailRow[]>;
};
type HomepageRailsResponse = { data?: HomepageRailsPayload | null; error?: unknown };

function homepageReasonFor(ep: FeedEpisode): string {
  const rank = Number(ep.podcasts?.podiverzum_rank) || 0;
  const tier = (ep.podcasts as any)?.rank_label;
  if (ep.freshness_bucket === "hot") return "friss";
  if (tier === "S" || tier === "A" || rank >= 7.5) return "top műsorból";
  if ((ep.topics || []).length > 0) return "téma alapján";
  return "szerkesztett ajánló";
}

const CATEGORY_COPY: Record<string, { title: string; subtitle: string }> = {
  "News": { title: "Értsd meg a világot", subtitle: "Közélet, hírek és háttérbeszélgetések emberi tempóban." },
  "News & Politics": { title: "Értsd meg a világot", subtitle: "Közélet, hírek és háttérbeszélgetések emberi tempóban." },
  "Business": { title: "Pénz és karrier", subtitle: "Gazdaság, vállalkozás, befektetés és munka." },
  "Business & Finance": { title: "Pénz és karrier", subtitle: "Gazdaság, vállalkozás, befektetés és munka." },
  "Finance": { title: "Pénzügy és befektetés", subtitle: "Piacok, vagyon, döntések és gazdasági háttér." },
  "Health & Fitness": { title: "Lélek és egészség", subtitle: "Pszichológia, önismeret, egészség és életmód." },
  "Health, Fitness & Longevity": { title: "Lélek és egészség", subtitle: "Pszichológia, önismeret, egészség és életmód." },
  "Technology": { title: "Technológia és MI", subtitle: "Technológia, mesterséges intelligencia és startup világ." },
  "Society & Culture": { title: "Sztorik és interjúk", subtitle: "Emberi történetek, kultúra és hosszabb beszélgetések." },
  "Comedy": { title: "Kikapcsolódás", subtitle: "Humor, könnyebb beszélgetések és szórakozás." },
  "Religion & Spirituality": { title: "Hit és spiritualitás", subtitle: "Vallási és lelki tartalmak külön válogatva." },
  "Sports": { title: "Sport és verseny", subtitle: "Futball, teljesítmény, háttérsztorik és sportkultúra." },
};

function homeCategoryCopy(category: string, fallback: string) {
  const label = categoryLabel(category) || categoryLabel(fallback) || "Válogatott epizódok";
  const safeTitle = /[&]|news|business|health|fitness|society|culture|religion|spirituality|technology|sports|comedy/i.test(label)
    ? "Válogatott epizódok"
    : label;
  return CATEGORY_COPY[category] || CATEGORY_COPY[fallback] || { title: safeTitle, subtitle: "Friss, odaillő epizódok ebben a témakörben." };
}

function categoryDiversityGroup(category: { name?: string | null; slug?: string | null; taxonomy_keys?: unknown }): string {
  const hay = [
    category.name,
    category.slug,
    ...(Array.isArray(category.taxonomy_keys) ? category.taxonomy_keys : []),
  ].filter(Boolean).join(" ").toLowerCase();
  if (/religion|spiritual|vallas|vallás|hit|spiritualitas|spiritualitás/.test(hay)) return "soul";
  if (/health|fitness|pszicho|onfejleszt|önfejleszt|eletmod|életmód|egeszseg|egészség/.test(hay)) return "soul";
  if (/news|politic|kozelet|közélet|h[ií]r|tarsadalom|társadalom/.test(hay)) return "public_affairs";
  if (/business|finance|gazdas|p[eé]nz|befektet|karrier|vallalkoz|vállalkoz/.test(hay)) return "business";
  if (/tech|technology|startup|ai|mi|tudomany|tudomány/.test(hay)) return "future";
  if (/culture|kultura|kultúra|society|story|interju|interjú|arts|book|irodalom/.test(hay)) return "culture";
  if (/comedy|humor|film|music|zene|sport|food|gasztro|crime|bűn|bun/.test(hay)) return "light";
  return "other";
}

function pickDiverseHomepageCategories<T extends { name?: string | null; slug?: string | null; taxonomy_keys?: unknown }>(items: T[], limit: number): T[] {
  const picked: T[] = [];
  const groupCounts = new Map<string, number>();
  for (const item of items) {
    const group = categoryDiversityGroup(item);
    if ((groupCounts.get(group) || 0) >= 1) continue;
    picked.push(item);
    groupCounts.set(group, 1);
    if (picked.length >= limit) return picked;
  }
  for (const item of items) {
    if (picked.includes(item)) continue;
    picked.push(item);
    if (picked.length >= limit) return picked;
  }
  return picked;
}

const Index = () => {
  const [q, setQ] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [trendingEps, setTrendingEps] = useState<FeedEpisode[]>([]);
  const [allEps, setAllEps] = useState<FeedEpisode[]>([]);
  const [categoryRailEps, setCategoryRailEps] = useState<Record<string, EpisodeLite[]>>({});
  const [evergreenEps, setEvergreenEps] = useState<EpisodeLite[]>([]);
  const [lightEps, setLightEps] = useState<EpisodeLite[]>([]);
  // Legacy example chips kept for fallback / future use; currently the hero
  // shows live trends via <HeroTrendsStrip /> instead.
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

  // (search_suggestions chip pool removed — live trends now occupy this slot)


  useEffect(() => {
    setSeo({
      title: "Podiverzum — magyar podcast kereső és ajánló",
      description: "Magyar podcast kereső, ajánló és felfedező. Keress epizódokat téma, személy, műsor, hangulat vagy gondolat alapján.",
      canonical: "https://podiverzum.hu/",
      image: "https://podiverzum.hu/og-image.jpg",
      hreflang: [
        { lang: "hu", href: "https://podiverzum.hu/" },
        { lang: "x-default", href: "https://podiverzum.hu/" },
      ],
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Podiverzum",
          alternateName: "Podiverzum.hu",
          url: "https://podiverzum.hu/",
          inLanguage: "hu-HU",
          publisher: sitePublisherJsonLd(),
          potentialAction: {
            "@type": "SearchAction",
            target: "https://podiverzum.hu/kereses?q={search_term_string}",
            "query-input": "required name=search_term_string",
          },
        },
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Podiverzum",
          url: "https://podiverzum.hu/",
          logo: "https://podiverzum.hu/icon-512.png",
          publisher: sitePublisherJsonLd(),
        },
        {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Magyar podcast kereső és ajánló",
          url: "https://podiverzum.hu/",
          inLanguage: "hu-HU",
          description: "Magyar podcast epizódok, műsorok, témák és személyes ajánlók felfedezése.",
        },
      ],
    });
    (async () => {
      try {
        const [catsRes, homepageRailsRes] = await Promise.all([
          supabase.from("categories").select("*").order("sort_order"),
          supabase
            .rpc("get_homepage_rails_with_images_v1" as never, {
              _trending_limit: 8,
              _evergreen_limit: 6,
              _category_limit: 6,
              _max_categories: 8,
            } as never),
        ]);

        setCats(catsRes.data || []);

        const mapRow = (r: any): FeedEpisode => {
          const ep: FeedEpisode = {
            id: r.episode_id,
            podcast_id: r.podcast_id,
            title: r.title,
            display_title: r.display_title,
            slug: r.slug,
            image_url: r.episode_image_url || r.image_url || null,
            ai_summary: r.ai_summary,
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
          };
          ep.homepageReason = homepageReasonFor(ep);
          return ep;
        };

        const loadFallbackRails = async () => {
          const [feedRes, evergreenRes] = await Promise.all([
            supabase
              .from("mv_homepage_feed" as any)
              .select("episode_id,title,display_title,slug,ai_summary,summary,description,published_at,audio_url,topics,podcast_id,podcast_slug,podcast_title,podcast_display_title,podcast_image_url,podcast_category,podiverzum_rank,rank_label,rss_status,featured,featured_rank,pod_rank,freshness_bucket")
              .lte("pod_rank", 6)
              .order("published_at", { ascending: false, nullsFirst: false })
              .limit(HOMEPAGE_EPISODE_LIMIT),
            supabase
              .from("mv_homepage_evergreen" as any)
              .select("episode_id,title,display_title,slug,summary,description,ai_summary,published_at,audio_url,topics,podcast_id,podcast_slug,podcast_title,podcast_display_title,podcast_image_url,podcast_category,podiverzum_rank,rank_label,rss_status,featured")
              .order("podiverzum_rank", { ascending: false, nullsFirst: false })
              .order("published_at", { ascending: false, nullsFirst: false })
              .limit(120),
          ]);

          const eps: FeedEpisode[] = (feedRes.data || []).map(mapRow);

          // Trending = last 14 days (hot+fresh). Fall back to recent (≤30d) if <8 items.
          const hotFresh = eps.filter((e) => e.freshness_bucket === "hot" || e.freshness_bucket === "fresh");
          const trendingPool = hotFresh.length >= 8 ? hotFresh : eps;
          // Editorial homepage scoring: tier/HU_v1 rank/featured dominate, freshness
          // softer & tier-aware, news mildly penalized (-12), bulletin/segment feeds
          // strongly penalized (-35). Hard caps in top 8: 2 ep/podcast, ≤2 news_like,
          // ≤1 bulletin_like. Backfill from overflow so the rail is never empty.
          const sorted = trendingPool.slice().sort(compareByHomepageScore);
          const PER_PODCAST_CAP = 2;
          const NEWS_TOP_CAP = 2;
          const BULLETIN_TOP_CAP = 1;
          const counts = new Map<string, number>();
          const primary: FeedEpisode[] = [];
          const overflow: FeedEpisode[] = [];
          let newsCount = 0;
          let bulletinCount = 0;
          for (const e of sorted) {
            const key = (e.podcasts as any)?.slug || (e.podcasts as any)?.title || "_";
            const n = counts.get(key) || 0;
            const news = isNewsLikeEpisode(e);
            const bulletin = isBulletinLikeEpisode(e);
            if (n >= PER_PODCAST_CAP) { overflow.push(e); continue; }
            if (bulletin && bulletinCount >= BULLETIN_TOP_CAP && primary.length < 8) { overflow.push(e); continue; }
            if (news && newsCount >= NEWS_TOP_CAP && primary.length < 8) { overflow.push(e); continue; }
            primary.push(e); counts.set(key, n + 1);
            if (news) newsCount += 1;
            if (bulletin) bulletinCount += 1;
          }

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

          return {
            eps,
            trending: avoidAdjacentSamePodcast([...primary, ...overflow]).slice(0, 8),
            evergreen: avoidAdjacentSamePodcast([...evergreenDiverse, ...evergreenSpill]).slice(0, 6),
          };
        };

        const homepageRailsResult = homepageRailsRes as HomepageRailsResponse;
        const homepageRails = homepageRailsResult.data || null;
        if (homepageRailsResult.error || !homepageRails) {
          console.warn("Homepage rails RPC failed, falling back to materialized views", homepageRailsResult.error);
          const fallback = await loadFallbackRails();
          setTrendingEps(fallback.trending);
          setAllEps(fallback.eps);
          setCategoryRailEps({});
          setEvergreenEps(fallback.evergreen);
        } else {
          const trending = (homepageRails.trending || []).map(mapRow);
          const evergreen = (homepageRails.evergreen || []).map(mapRow);
          const categories: Record<string, EpisodeLite[]> = {};
          Object.entries(homepageRails.categories || {}).forEach(([category, rows]) => {
            categories[category] = avoidAdjacentSamePodcast((rows || []).map(mapRow)).slice(0, 6);
          });
          setTrendingEps(diversifyByPodcast(trending, 8, 2));
          setAllEps(Object.values(categories).flat() as FeedEpisode[]);
          setCategoryRailEps(categories);
          setEvergreenEps(diversifyByPodcast(evergreen, 6, 1));
        }
      } catch (err) {
        console.error("Index load failed", err);
        setLoadError(true);
      } finally {
        setLoaded(true);
      }
    })();

    // Dedicated "Kikapcsolódás" rail — always shown, aggregates light/entertainment
    // categories that otherwise get squeezed out by News/Business/Tech in the
    // top-3 dynamic rotation.
    (async () => {
      const LIGHT_CATEGORIES = [
        "Comedy",
        "Film, TV & Pop Culture",
        "Music",
        "Sports",
        "True Crime & Paranormal",
        "Food",
        "Books & Literature Fiction & Audio Drama",
        "Fiction & Audio Drama",
        "Kids & Family",
        "Arts",
      ];
      try {
        const { data, error } = await supabase
          .from("mv_homepage_feed" as any)
          .select("episode_id,title,display_title,slug,ai_summary,summary,description,published_at,audio_url,topics,podcast_id,podcast_slug,podcast_title,podcast_display_title,podcast_image_url,podcast_category,podiverzum_rank,rank_label,rss_status,featured,featured_rank,pod_rank,freshness_bucket")
          .in("podcast_category", LIGHT_CATEGORIES)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(120);
        if (error || !data) return;
        const mapped: FeedEpisode[] = (data as any[]).map((r: any) => ({
          id: r.episode_id,
          podcast_id: r.podcast_id,
          title: r.title,
          display_title: r.display_title,
          slug: r.slug,
          ai_summary: r.ai_summary,
          summary: r.summary,
          description: r.description,
          image_url: r.episode_image_url || r.image_url || null,
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
        }));
        // Filter out news/bulletin (shouldn't appear in these categories anyway, but belt+braces)
        const clean = mapped.filter((e) => !isNewsLikeEpisode(e) && !isBulletinLikeEpisode(e));
        // Editorial sort: tier+rank+freshness; max 1 per podcast for max variety on this rail.
        const sorted = clean.slice().sort(compareByHomepageScore);
        setLightEps(diversifyByPodcast(sorted, 8, 1));
      } catch (e) {
        console.warn("Light rail fetch failed", e);
      }
    })();
  }, []);


  const epsByCat = useMemo(() => {
    if (Object.keys(categoryRailEps).length > 0) return categoryRailEps;
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
      // Mild downweight: if news+bulletin items dominate (>50% of rail),
      // demote them below the non-news/non-bulletin items. No hard cap.
      const heavy = (e: any) => isNewsLikeEpisode(e) || isBulletinLikeEpisode(e);
      const heavyItems = ordered.filter(heavy);
      if (ordered.length > 0 && heavyItems.length * 2 > ordered.length) {
        const light = ordered.filter((e) => !heavy(e));
        ordered = [...light, ...heavyItems];
      }
      grouped[k] = avoidAdjacentSamePodcast(ordered).slice(0, 6);
    });
    return grouped;
  }, [allEps, categoryRailEps]);

  useEffect(() => {
    auditHomepageRail("most_erdemes", trendingEps);
    auditHomepageRail("kikapcsolodas", lightEps);
    auditHomepageRail("idotallo", evergreenEps);
    Object.entries(epsByCat).forEach(([name, items]) => auditHomepageRail(`category:${name}`, items));
  }, [trendingEps, lightEps, evergreenEps, epsByCat]);


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
            Magyar podcastok. <span className="text-brand-gradient">Okosabban.</span>
          </h1>

          <p className="text-foreground/90 mt-4 sm:mt-6 max-w-2xl text-base sm:text-lg leading-relaxed animate-fade-up font-medium">
            Keress úgy, ahogy gondolkodsz: téma, személy, műsor, hangulat vagy gondolat alapján.
          </p>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm sm:text-base leading-relaxed animate-fade-up">
            A Podiverzum az epizódok tartalma alapján mutatja meg, mit érdemes meghallgatni.
          </p>
          {!hasSearched && q.length === 0 && (
            <div className="mt-3 animate-fade-up">
              <Link
                to="/trendek"
                className="group inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-primary/80 hover:text-primary font-semibold transition-colors"
              >
                <TrendingUp className="h-3.5 w-3.5" />
                Miről beszél ma az ország?
                <ArrowRight className="h-3 w-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
              </Link>
            </div>
          )}
          <div ref={heroWrapRef} className="mt-5 sm:mt-8 max-w-2xl relative animate-fade-up">
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
                      <img
                        src={optimizedImageUrl(s.image_url, { width: 40, height: 40 }) || s.image_url}
                        srcSet={imageSrcSet(s.image_url, [28, 40, 56])}
                        sizes="28px"
                        alt=""
                        loading="lazy"
                        decoding="async"
                        width={40}
                        height={40}
                        className="h-7 w-7 rounded object-cover bg-muted shrink-0"
                      />
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
            <Suspense fallback={null}>
              <HeroTrendsStrip />
            </Suspense>
          )}
          <div className="mt-4">
            <Link
              to="/te-podiverzumod"
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
        <Suspense fallback={null}>
          <TrendingPodcasts />
          <HomeDiscoveryShortcuts />
          <WeeklyEditorialStrip />
          <MyLibraryRails />
          <ContinueListening />
          <PersonalizedHomeRails />
        </Suspense>
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
                <h2 className="text-2xl font-semibold tracking-tight">Most érdemes meghallgatni</h2>
                <p className="text-xs text-muted-foreground mt-1">Friss, népszerű és tartalmilag erős epizódok szerkesztett válogatása.</p>
              </div>
            </div>
            <EpisodeList items={trendingEps} scrollAlways />
          </section>
        )}

        {lightEps.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Kikapcsolódás</h2>
                <p className="text-xs text-muted-foreground mt-1">Humor, popkultúra, zene, sport, gasztro és könnyebb beszélgetések — amikor csak feltöltődni szeretnél.</p>
              </div>
            </div>
            <EpisodeList items={lightEps} scrollAlways />
          </section>
        )}

        <Suspense fallback={null}>
          <MoodCollections />
        </Suspense>




        {(() => {
          // HU categories map to one or more English taxonomy buckets via taxonomy_keys.
          // Aggregate episode lists across all mapped keys for each HU tile.
          const itemsForCat = (c: any): EpisodeLite[] => {
            const keys: string[] = Array.from(new Set([
              c.name,
              ...(Array.isArray(c.taxonomy_keys) ? c.taxonomy_keys : []),
            ].filter(Boolean)));
            const merged: EpisodeLite[] = [];
            const seen = new Set<string>();
            for (const k of keys) {
              for (const e of (epsByCat[k] || [])) {
                if (seen.has(e.id)) continue;
                seen.add(e.id);
                merged.push(e);
              }
            }
            return diversifyByPodcast(merged, 6, 2);
          };
          const populated = cats
            .filter((c: any) => c.slug !== "trending" && itemsForCat(c).length > 0)
            .sort((a: any, b: any) => itemsForCat(b).length - itemsForCat(a).length);
          const visibleCategories = pickDiverseHomepageCategories(populated, 3);
          return visibleCategories.map((c: any) => {
            const items = itemsForCat(c);
            const copy = homeCategoryCopy(c.name, c.name);
            return (
              <section key={c.id}>
                <div className="flex items-end justify-between mb-1">
                  <h2 className="text-xl sm:text-2xl font-semibold">{copy.title}</h2>
                  <Link to={`/kategoria/${c.slug}`} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                    Több epizód <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                <p className="text-xs text-muted-foreground mb-4">{copy.subtitle}</p>
                <EpisodeList items={items} scrollAlways />

              </section>
            );
          });
        })()}

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

        {loaded && !trendingEps.length && (
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
