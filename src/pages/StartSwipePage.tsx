import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, PanInfo, useMotionValue, useTransform } from "framer-motion";
import { Heart, X, Sparkles, RotateCcw, ArrowRight, Share2, Play, Star, ThumbsUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Vec, zero, mean, sub, scale, add, cosine, coherence, normalize, toPgVector, parsePgVector,
} from "@/lib/tasteVector";
import { ARCHETYPES, pickArchetype, archetypeConfidence } from "@/lib/tasteArchetypes";
// (image share-card no longer used here; switched to public share-link flow)
import { buildAura, buildConstellation, buildVerdict, buildPdvCode, buildElement } from "@/lib/podiverzumProfile";
import { isCompletedTasteProgress, shouldCompleteTasteProfile, tasteProgressCopy } from "@/lib/tasteCompletion";
import { toast } from "sonner";
import { SoftAuthCTA } from "@/components/SoftAuthCTA";
import { EmailCaptureCard } from "@/components/EmailCaptureCard";
import { trackLandingEvent, snapshotUtmFromUrl } from "@/lib/landingEvents";
import { notifyLiveEvent } from "@/lib/liveTelegramNotify";
import { ListenerReceipt } from "@/components/receipt/ListenerReceipt";
import { profileForArchetypeId, buildReceiptNumber } from "@/lib/listenerProfiles";
import { renderReceiptPng, downloadReceipt } from "@/lib/receiptImage";
import { trackProfileEvent, captureSourceProfileFromUrl, getSourceProfileId } from "@/lib/profileEvents";
import { Download, Link2 } from "lucide-react";
import { imageSrcSet, optimizedImageUrl } from "@/lib/image";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";

// Mystical match label — never expose the score, only a feeling.
function mysticMatch(score: number, idx: number): string {
  if (idx === 0) return "Sorsszerű találat";
  if (score >= 0.78) return "Mély visszhang";
  if (score >= 0.7) return "Erős rezonancia";
  if (score >= 0.62) return "Halk hívás";
  return "Sejtetett kapocs";
}

/* ────────────────── Types ────────────────── */

type Card = {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  stage: string;
  sensitivity_level: string;
  priority: number;
  topic_tags: string[];
  mood_tags: string[];
  format_tags: string[];
  psych_tags: string[];
  archetype_tags: string[];
  catalog_fit_score: number | null;
  top_episode_similarity: number | null;
  card_embedding: Vec;
};

type RecEp = {
  episode_id: string;
  podcast_id: string;
  title: string;
  display_title: string | null;
  slug: string;
  image_url: string | null;
  ai_summary: string | null;
  podcast_title: string;
  podcast_slug: string;
  podcast_image_url: string | null;
  similarity: number;
  final_score: number;
  topics: string[] | null;
  category: string | null;
  published_at?: string | null;
  /** client-side re-rank score (vector + tag-overlap) */
  taste_score?: number;
  /** client-side: which of your top interests this episode matches */
  reasons?: string[];
};

type Phase = "intro" | "swipe" | "result";
type SwipeAction = "like" | "skip" | "super";

const STORAGE_KEY = "podiverzum_taste_v1";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://yoxewklaybougzpmzvkg.supabase.co";
const SHARE_FN_URL = `${SUPABASE_URL}/functions/v1/te-podiverzumod-share`;

type Persisted = {
  sessionId: string;
  seenCardIds: string[];
  likedCardIds: string[];
  dislikedCardIds: string[];
  superLikedCardIds: string[];
  cardSnapshots?: Record<string, Card>;
  completedAt?: string | null;
  updatedAt: string;
};

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const normalized: Persisted = {
        sessionId: p.sessionId || crypto.randomUUID(),
        seenCardIds: p.seenCardIds || [],
        likedCardIds: p.likedCardIds || [],
        dislikedCardIds: p.dislikedCardIds || [],
        superLikedCardIds: p.superLikedCardIds || [],
        cardSnapshots: p.cardSnapshots || {},
        completedAt: p.completedAt || null,
        updatedAt: p.updatedAt || new Date().toISOString(),
      };
      if (!normalized.completedAt && isCompletedTasteProgress(normalized)) {
        normalized.completedAt = normalized.updatedAt || new Date().toISOString();
        savePersisted(normalized);
      }
      return normalized;
    }
  } catch { /* ignore */ }
  return {
    sessionId: crypto.randomUUID(),
    seenCardIds: [],
    likedCardIds: [],
    dislikedCardIds: [],
    superLikedCardIds: [],
    cardSnapshots: {},
    completedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

function savePersisted(p: Persisted) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...p, updatedAt: new Date().toISOString() })); } catch { /* ignore */ }
}

function snapshotCard(card: Card): Card {
  return {
    ...card,
    topic_tags: card.topic_tags || [],
    mood_tags: card.mood_tags || [],
    format_tags: card.format_tags || [],
    psych_tags: card.psych_tags || [],
    archetype_tags: card.archetype_tags || [],
    card_embedding: card.card_embedding || [],
  };
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function shareProfileLink(opts: { title: string; text: string; url: string }): Promise<"shared" | "copied" | "cancelled" | "error"> {
  try {
    if (navigator.share) {
      await navigator.share(opts);
      return "shared";
    }
  } catch (e: any) {
    if (e?.name === "AbortError") return "cancelled";
  }
  return (await copyText(opts.url)) ? "copied" : "error";
}

function stableHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed: string): () => number {
  let t = stableHash(seed) || 1;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/* ────────────────── Stopping logic ────────────────── */

function swipeFeedback(action: SwipeAction, totalSwipes: number): string {
  if (action === "super") return "Ez erős jel. Ebből többet keresünk.";
  if (action === "like") {
    if (totalSwipes <= 2) return "Megvan az első irány.";
    if (totalSwipes <= 6) return "Finomodik az ízlésprofilod.";
    return "Ezt beleszámoljuk az ajánlásokba.";
  }
  if (totalSwipes <= 2) return "Oké, ezt elengedjük.";
  return "Hasznos passz. Ebből is tanul a rendszer.";
}

/* ────────────────── Tag weights aggregation ────────────────── */

function tagWeights(cards: Card[]): Record<string, number> {
  const w: Record<string, number> = {};
  for (const c of cards) {
    const tags = [...c.topic_tags, ...c.mood_tags, ...c.archetype_tags, ...c.psych_tags, ...c.format_tags];
    for (const t of tags) w[t] = (w[t] || 0) + 1;
  }
  return w;
}

function buildEffectiveLiked(liked: Card[], superLiked: Card[]): Card[] {
  return [...liked, ...superLiked, ...superLiked];
}

function topTags(weights: Record<string, number>, n: number): string[] {
  return Object.entries(weights).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

const TAG_LABELS: Record<string, string> = {
  ai: "MI",
  "mesterséges intelligencia": "mesterséges intelligencia",
  technológia: "technológia",
  gazdaság: "gazdaság",
  pénzügy: "pénzügy",
  befektetés: "befektetés",
  közélet: "közélet",
  politika: "közélet",
  társadalom: "társadalmi témák",
  kultúra: "kultúra",
  irodalom: "irodalom",
  film: "film",
  tudomány: "tudomány",
  pszichológia: "pszichológia",
  önfejlesztés: "önfejlesztés",
  sport: "sport",
  humor: "humor",
  mélyinterjú: "mélyebb beszélgetések",
  interjú: "interjúk",
};

function tagLabel(tag: string): string {
  const key = tag.toLowerCase();
  return TAG_LABELS[key] || tag;
}

function primaryReason(r: RecEp): string {
  const reasons = (r.reasons || []).map(tagLabel).filter(Boolean);
  if (reasons.length) return `Passzol: ${reasons.slice(0, 2).join(" + ")}`;
  if (r.category) return `Irány: ${r.category}`;
  return "Az ízlésprofilod alapján";
}

const NEWS_LIKE_RX = /\b(hírek|hír|hírösszefoglaló|hírháttér|hírpercek|krónika|infostart|napi hírek|reggeli hírek|esti hírek|news|bulletin)\b/i;
const BULLETIN_LIKE_RX = /\b(hírek röviden|hírpercek|hírgyors|napi hírek|reggeli hírek|déli hírek|esti hírek|éjszakai hírek|hírösszefoglaló|infostart hírek|percben|perces hír|bulletin)\b/i;

function recHaystack(r: RecEp): string {
  return [
    r.title,
    r.display_title,
    r.podcast_title,
    r.category,
    ...(r.topics || []),
  ].filter(Boolean).join(" ").toLowerCase();
}

const INTEREST_GROUPS: Record<string, string[]> = {
  tech: ["tech", "technológia", "technologia", "mi", "ai", "mesterséges intelligencia", "mesterséges", "startup", "jövő", "jovo", "digitalis", "digitális"],
  business: ["gazdaság", "gazdasag", "pénz", "penz", "pénzügy", "penzugy", "üzlet", "uzlet", "business", "befektetés", "befektetes", "tőzsde", "tozsde", "vállalkozás", "vallalkozas", "karrier"],
  public_affairs: ["közélet", "kozelet", "politika", "hírek", "hirek", "társadalom", "tarsadalom", "geopolitika", "közbeszéd", "kozbeszed"],
  culture: ["kultúra", "kultura", "film", "mozi", "sorozat", "zene", "könyv", "konyv", "irodalom", "színház", "szinhaz"],
  science: ["tudomány", "tudomany", "űr", "ur", "kutatás", "kutatas", "természet", "termeszet"],
  mind: ["pszichológia", "pszichologia", "mentális", "mentalis", "önismeret", "onismeret", "lélek", "lelek"],
  health: ["egészség", "egeszseg", "életmód", "eletmod", "orvos", "sport", "edzés", "edzes"],
  crime: ["bűnügy", "bunugy", "true crime", "krimi", "nyomozás", "nyomozas"],
  travel: ["utazás", "utazas", "világ", "vilag", "külföld", "kulfold"],
  food: ["gasztronómia", "gasztronomia", "kaja", "étel", "etel", "főzés", "fozes"],
  humor: ["humor", "standup", "stand-up", "szórakozás", "szorakozas"],
};

function normalizeInterest(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function interestGroupsForText(value: string | null | undefined): string[] {
  const text = normalizeInterest(value);
  if (!text) return [];
  const groups: string[] = [];
  for (const [group, terms] of Object.entries(INTEREST_GROUPS)) {
    if (terms.some((term) => text.includes(normalizeInterest(term)))) groups.push(group);
  }
  return groups;
}

function expandTasteTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const tag of tags) {
    const normalized = normalizeInterest(tag);
    if (!normalized || normalized.length < 3) continue;
    out.add(normalized);
    for (const group of interestGroupsForText(normalized)) {
      out.add(group);
      for (const term of INTEREST_GROUPS[group] || []) out.add(normalizeInterest(term));
    }
  }
  return Array.from(out).filter((tag) => tag.length >= 3);
}

function episodeInterestKeys(r: RecEp): Set<string> {
  const values = [
    r.category || "",
    ...(r.topics || []),
    recHaystack(r),
  ];
  const keys = new Set<string>();
  for (const value of values) {
    const normalized = normalizeInterest(value);
    if (normalized.length >= 3) keys.add(normalized);
    for (const group of interestGroupsForText(value)) keys.add(group);
  }
  return keys;
}

function isBulletinLike(r: RecEp): boolean {
  const hay = recHaystack(r);
  return BULLETIN_LIKE_RX.test(hay) || /^\s*\d{1,2}\s*[-–—]\s+/.test(r.title || "");
}

function isNewsLike(r: RecEp): boolean {
  const hay = recHaystack(r);
  return isBulletinLike(r) || NEWS_LIKE_RX.test(hay) || (r.category || "").toLowerCase().includes("news");
}

/* ────────────────── Next-card selector ────────────────── */

const BROAD_DOMAINS = [
  "gazdaság", "közélet", "technológia", "pszichológia",
  "kultúra", "tudomány", "hit", "humor",
  "irodalom", "gasztronómia", "utazás", "bűnügy",
];


function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickWeighted<T>(items: { item: T; score: number }[], rng: () => number = Math.random): T {
  // Softmax-like weighted random — favors top items but never deterministic
  const max = Math.max(...items.map(i => i.score));
  const weights = items.map(i => Math.exp((i.score - max) * 6));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i].item;
  }
  return items[items.length - 1].item;
}

function pickNextCard(
  pool: Card[],
  seen: Set<string>,
  liked: Card[],
  disliked: Card[],
  swipeIdx: number,
  sessionSeed: string,
  domainOrder: string[] = BROAD_DOMAINS,
): Card | null {
  const candidates = pool.filter(c => !seen.has(c.id));
  if (candidates.length === 0) return null;
  const stateSeed = [
    sessionSeed,
    swipeIdx,
    ...Array.from(seen).sort(),
    ...liked.map(c => c.id).sort(),
    ...disliked.map(c => c.id).sort(),
  ].join("|");
  const rng = seededRandom(stateSeed);

  // First 8 swipes: ensure broad coverage, rotate domains (order shuffled per session)
  if (swipeIdx < 8) {
    const wantedDomain = domainOrder[swipeIdx % domainOrder.length];
    const broadMatches = candidates.filter(
      c => c.stage === "broad" && (c.topic_tags.includes(wantedDomain) || c.archetype_tags.includes(wantedDomain))
    );
    if (broadMatches.length > 0) {
      const shuffled = shuffle(broadMatches, rng);
      return shuffled[Math.floor(rng() * Math.min(5, shuffled.length))];
    }
    const anyBroad = shuffle(candidates.filter(c => c.stage === "broad"), rng);
    if (anyBroad.length > 0) return anyBroad[0];
  }

  // Adaptive scoring
  const posMean = liked.length ? mean(liked.map(c => c.card_embedding)) : null;
  const negMean = disliked.length ? mean(disliked.map(c => c.card_embedding)) : null;
  const likedTags = tagWeights(liked);

  const scored = candidates.map(c => {
    const relevance = posMean ? Math.max(0, cosine(c.card_embedding, posMean)) : 0;
    const uncertainty = posMean ? 1 - Math.abs(relevance - 0.5) * 2 : 0.5;
    const cardTagWeight = [...c.topic_tags, ...c.archetype_tags]
      .reduce((s, t) => s + (likedTags[t] || 0), 0);
    const coverageGap = 1 / (1 + cardTagWeight);
    const negSim = negMean ? Math.max(0, cosine(c.card_embedding, negMean)) : 0;
    const disamb = 1 - negSim;
    const rand = rng();
    const score = 0.30 * uncertainty + 0.22 * relevance + 0.20 * coverageGap + 0.10 * disamb + 0.18 * rand;
    return { item: c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  // Seeded weighted sample from the top 8: varied, but stable for the same choices.
  return pickWeighted(scored.slice(0, 8), rng);
}

/* ────────────────── Confidence ────────────────── */

function computeConfidence(liked: Card[], disliked: Card[]): number {
  if (liked.length === 0) return 0;
  const posVecs = liked.map(c => c.card_embedding);
  const negVecs = disliked.map(c => c.card_embedding);
  const posMean = mean(posVecs);
  const negMean = negVecs.length ? mean(negVecs) : null;

  // positive signal: more likes = stronger (cap at 8)
  const positiveSignal = Math.min(1, liked.length / 8);
  // coherence: how consistent are the likes
  const coh = Math.max(0, coherence(posVecs));
  // separation: how distinct from negatives
  const sep = negMean ? Math.max(0, 1 - Math.max(0, cosine(posMean, negMean))) : 0.5;
  // catalog match strength: avg top_episode_similarity of liked cards
  const fits = liked.map(c => Number(c.top_episode_similarity || c.catalog_fit_score || 0)).filter(v => v > 0);
  const catalog = fits.length ? Math.min(1, fits.reduce((s, v) => s + v, 0) / fits.length / 0.7) : 0.4;
  // archetype confidence
  const archConf = archetypeConfidence(tagWeights(liked));

  return Math.min(1,
    0.25 * positiveSignal +
    0.25 * coh +
    0.20 * sep +
    0.15 * catalog +
    0.15 * archConf
  );
}

/* ────────────────── Page ────────────────── */

export default function StartSwipePage() {
  const navigate = useNavigate();
  const [persisted, setPersisted] = useState<Persisted>(() => loadPersisted());
  // Skip the redundant intro screen — /start landing already explains the experience.
  // If the user already has a result (>= confidence threshold reached), jump to result.
  const initialPhase: Phase = (() => {
    try {
      const p = loadPersisted();
      if (isCompletedTasteProgress(p)) return "result";
    } catch { /* ignore */ }
    return "swipe";
  })();
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [pool, setPool] = useState<Card[] | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [poolLoadNonce, setPoolLoadNonce] = useState(0);
  const [current, setCurrent] = useState<Card | null>(null);
  const [recs, setRecs] = useState<RecEp[] | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [lastSwipeFeedback, setLastSwipeFeedback] = useState<string | null>(null);

  // Derived collections
  const byId = useMemo(() => {
    const m = new Map<string, Card>();
    Object.values(persisted.cardSnapshots || {}).forEach(c => {
      if (c?.id) m.set(c.id, snapshotCard(c));
    });
    (pool || []).forEach(c => m.set(c.id, c));
    return m;
  }, [pool, persisted.cardSnapshots]);

  const liked = useMemo(
    () => persisted.likedCardIds.map(id => byId.get(id)).filter((c): c is Card => !!c),
    [persisted.likedCardIds, byId]
  );
  const disliked = useMemo(
    () => persisted.dislikedCardIds.map(id => byId.get(id)).filter((c): c is Card => !!c),
    [persisted.dislikedCardIds, byId]
  );
  const superLiked = useMemo(
    () => persisted.superLikedCardIds.map(id => byId.get(id)).filter((c): c is Card => !!c),
    [persisted.superLikedCardIds, byId]
  );

  // Vector weighting: super-likes count 3x (duplicated in the positive set).
  // Stronger weighting = the user's strongest signals dominate the taste vector
  // and the result feels "this is really me" instead of generic.
  const effectiveLiked = useMemo(
    () => buildEffectiveLiked(liked, superLiked),
    [liked, superLiked],
  );

  const totalSwipes = persisted.seenCardIds.length;
  const positiveSwipes = persisted.likedCardIds.length;
  const superSwipes = persisted.superLikedCardIds.length;
  const confidence = useMemo(
    () => computeConfidence(effectiveLiked, disliked),
    [effectiveLiked, disliked]
  );
  const sessionDomainOrder = useMemo(
    () => shuffle(BROAD_DOMAINS, seededRandom(`domains:${persisted.sessionId}`)),
    [persisted.sessionId],
  );

  // Load card pool once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPoolError(null);
      const { data, error } = await supabase.rpc("get_active_taste_cards", { p_limit: 500 });
      if (cancelled) return;
      if (error) { setPoolError(error.message); return; }
      const cards: Card[] = (data || []).map((r: any) => ({
        ...r,
        card_embedding: parsePgVector(r.card_embedding) || [],
      })).filter((c: Card) => c.card_embedding.length === 768);
      setPool(cards);
    })();
    return () => { cancelled = true; };
  }, [poolLoadNonce]);

  // Fire SwipeStarted on first mount when starting directly in swipe phase
  useEffect(() => {
    if (initialPhase === "swipe") {
      snapshotUtmFromUrl();
      captureSourceProfileFromUrl();
      trackLandingEvent("SwipeStarted");
      trackProfileEvent("swipe_started");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop-off telemetry: fire SwipeAbandoned if the user leaves while still in the swipe.
  // Fires even when total=0 so we can see how many users bail before swiping a single card
  // (the "97% drop-off" we observed comes from this silent group).
  const completedRef = useRef(false);
  const cardShownRef = useRef(false);
  const firstActionRef = useRef(false);
  useEffect(() => {
    if (phase !== "swipe") return;
    const fire = () => {
      if (completedRef.current) return;
      const total = persisted.seenCardIds.length;
      const positives = persisted.likedCardIds.length;
      trackLandingEvent("SwipeAbandoned", {
        total,
        positives,
        card_shown: cardShownRef.current,
        pool_loaded: !!pool,
        pool_error: !!poolError,
        stage: total === 0
          ? (cardShownRef.current ? "before_first_swipe" : (poolError ? "pool_error" : "before_card_shown"))
          : "mid_swipe",
      });
      completedRef.current = true; // only fire once
    };
    const onVis = () => { if (document.visibilityState === "hidden") fire(); };
    window.addEventListener("pagehide", fire);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", fire);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [phase, persisted.seenCardIds.length, persisted.likedCardIds.length, pool, poolError]);

  // Fire SwipeCardShown the first time a real card is rendered (filters loading errors).
  useEffect(() => {
    if (phase !== "swipe" || !current || cardShownRef.current) return;
    cardShownRef.current = true;
    trackLandingEvent("SwipeCardShown", { card_id: current.id });
  }, [phase, current]);

  // Fire SwipePoolError if the card pool fails to load.
  const poolErrorReportedRef = useRef(false);
  useEffect(() => {
    if (!poolError || poolErrorReportedRef.current) return;
    poolErrorReportedRef.current = true;
    trackLandingEvent("SwipePoolError", { error: poolError });
  }, [poolError]);


  // Pick first card when entering swipe phase
  useEffect(() => {
    if (phase !== "swipe" || !pool || current) return;
    const seen = new Set(persisted.seenCardIds);
    const next = pickNextCard(pool, seen, effectiveLiked, disliked, totalSwipes, persisted.sessionId, sessionDomainOrder);
    setCurrent(next);
  }, [phase, pool, current, persisted.seenCardIds, effectiveLiked, disliked, totalSwipes, persisted.sessionId, sessionDomainOrder]);

  // Auto-fetch recs when entering result. Completed profiles must survive card
  // pool refreshes, so saved card snapshots are enough to reconstruct the taste.
  useEffect(() => {
    if (phase !== "result" || recs || recsLoading) return;
    if (effectiveLiked.length === 0) return;
    void fetchRecs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, pool, effectiveLiked.length, recs, recsLoading]);

  const fetchRecs = async () => {
    if (effectiveLiked.length === 0) return;
    setRecsLoading(true);
    setRecsError(null);

    // Build the user's "taste fingerprint" before the RPC call so the page can
    // still produce useful recommendations if the vector matcher is temporarily unavailable.
    const tagW: Record<string, number> = {};
    const antiW: Record<string, number> = {};
    const bump = (target: Record<string, number>, arr: string[] | undefined, k: number) => {
      if (!arr) return;
      for (const t of arr) {
        const key = t.toLowerCase();
        target[key] = (target[key] || 0) + k;
      }
    };
    for (const c of liked) {
      bump(tagW, c.topic_tags, 1); bump(tagW, c.mood_tags, 1); bump(tagW, c.archetype_tags, 1);
    }
    for (const c of superLiked) {
      bump(tagW, c.topic_tags, 3); bump(tagW, c.mood_tags, 3); bump(tagW, c.archetype_tags, 3);
    }
    // Anti-tags: what the user explicitly skipped — but ONLY if not also liked.
    for (const c of disliked) {
      bump(antiW, c.topic_tags, 1); bump(antiW, c.mood_tags, 1); bump(antiW, c.archetype_tags, 1);
    }
    for (const k of Object.keys(antiW)) {
      if (tagW[k]) delete antiW[k]; // tag is loved AND skipped → ambiguous, ignore as anti
    }

    // Mean-center against the pool centroid so the user's *deviation* dominates.
    const centroidSource = pool?.length
      ? pool.map(c => c.card_embedding)
      : [...effectiveLiked, ...disliked].map(c => c.card_embedding);
    const centroid = mean(centroidSource);
    const likedDev = mean(effectiveLiked.map(c => sub(c.card_embedding, centroid)));
    const dislikedDev = disliked.length
      ? mean(disliked.map(c => sub(c.card_embedding, centroid)))
      : zero(centroid.length);
    const direction = sub(likedDev, dislikedDev);
    const userVec = normalize(add(centroid, scale(direction, 2.5)));
    const negVec = disliked.length
      ? normalize(add(centroid, scale(dislikedDev, 2.5)))
      : null;

    // Over-fetch so we have enough headroom for quality caps and diversity.
    const { data, error } = await supabase.rpc("match_episodes_by_taste_vector", {
      p_user_vector: toPgVector(userVec) as any,
      p_negative_vector: negVec ? (toPgVector(negVec) as any) : null,
      p_exclude_episode_ids: [],
      p_limit: 80,
    });

    let recommendationRows = (data as RecEp[] | null) || null;
    if (error || !recommendationRows) {
      const fallbackTags = Object.entries(tagW)
        .sort((a, b) => b[1] - a[1])
        .map(([tag]) => tag)
        .filter((tag) => tag.length >= 3)
        .slice(0, 8);
      const expandedFallbackTags = expandTasteTags(fallbackTags).slice(0, 24);

      let fallbackQuery = supabase
        .from("episodes")
        .select("episode_id:id,podcast_id,title,display_title,slug,image_url,ai_summary,audio_url,published_at,topics,podcasts!inner(slug,title,display_title,image_url,category,is_hungarian,language_decision,rss_status)")
        .not("audio_url", "is", null)
        .eq("podcasts.is_hungarian", true)
        .eq("podcasts.language_decision", "accept_hungarian")
        .not("podcasts.rss_status", "in", "(failed,inactive,deleted)")
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(80);
      if (expandedFallbackTags.length > 0) fallbackQuery = fallbackQuery.overlaps("topics", expandedFallbackTags);

      const { data: fallbackDataRaw } = await fallbackQuery;
      let fallbackData = fallbackDataRaw || [];
      if (fallbackData.length === 0 && fallbackTags.length > 0) {
        const { data: broadFallbackData } = await supabase
          .from("episodes")
          .select("episode_id:id,podcast_id,title,display_title,slug,image_url,ai_summary,audio_url,published_at,topics,podcasts!inner(slug,title,display_title,image_url,category,is_hungarian,language_decision,rss_status)")
          .not("audio_url", "is", null)
          .eq("podcasts.is_hungarian", true)
          .eq("podcasts.language_decision", "accept_hungarian")
          .not("podcasts.rss_status", "in", "(failed,inactive,deleted)")
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(80);
        fallbackData = broadFallbackData || [];
      }
      recommendationRows = ((fallbackData || []) as any[]).map((r) => {
        const podcast = Array.isArray(r.podcasts) ? r.podcasts[0] : r.podcasts;
        return {
          episode_id: r.episode_id,
          podcast_id: r.podcast_id,
          title: r.title,
          display_title: r.display_title,
          slug: r.slug,
          image_url: r.image_url,
          ai_summary: r.ai_summary,
          podcast_title: podcast?.display_title || podcast?.title || "Podcast",
          podcast_slug: podcast?.slug || "",
          podcast_image_url: podcast?.image_url || null,
          similarity: 0.55,
          final_score: 0.52,
          topics: r.topics || null,
          category: podcast?.category || null,
          published_at: r.published_at,
        } as RecEp;
      });
      if (recommendationRows.length === 0) {
        setRecs([]);
        setRecsLoading(false);
        return;
      }
    }
    const maxW = Math.max(1, ...Object.values(tagW));
    const maxAntiW = Math.max(1, ...Object.values(antiW));
    const newsSignal =
      (tagW.közélet || 0) +
      (tagW.politika || 0) +
      (tagW["magyar közélet"] || 0) +
      (tagW.hírek || 0) +
      (tagW.geopolitika || 0);
    const allowsNews = newsSignal >= 4;
    const allowsBulletins = newsSignal >= 7;
    const expandedTagW: Record<string, number> = {};
    const expandedAntiW: Record<string, number> = {};
    for (const [tag, weight] of Object.entries(tagW)) {
      for (const expanded of expandTasteTags([tag])) {
        expandedTagW[expanded] = Math.max(expandedTagW[expanded] || 0, weight);
      }
    }
    for (const [tag, weight] of Object.entries(antiW)) {
      for (const expanded of expandTasteTags([tag])) {
        expandedAntiW[expanded] = Math.max(expandedAntiW[expanded] || 0, weight);
      }
    }

    // Re-rank: vector + positive tag overlap − anti-tag penalty + small freshness nudge.
    const now = Date.now();
    const rows = recommendationRows.map(r => {
      const epTags = episodeInterestKeys(r);
      let overlap = 0;
      let antiOverlap = 0;
      const matched: Array<{ tag: string; w: number }> = [];
      for (const t of epTags) {
        const w = expandedTagW[t] || tagW[t];
        if (w) { overlap += w; matched.push({ tag: t, w }); }
        const aw = expandedAntiW[t] || antiW[t];
        if (aw) antiOverlap += aw;
      }
      const normOverlap = Math.min(1, overlap / (maxW * 2));
      const normAnti = Math.min(1, antiOverlap / (maxAntiW * 2));
      const normSim = Math.max(0, Math.min(1, Number((r as any).final_score) || 0));
      // Small extra freshness bump client-side (RPC already gives some).
      const publishedAt = (r as any).published_at ? new Date((r as any).published_at).getTime() : 0;
      const ageDays = publishedAt ? (now - publishedAt) / 86_400_000 : 9999;
      const freshBonus = ageDays < 7 ? 0.05 : ageDays < 30 ? 0.025 : 0;
      const bulletinPenalty = isBulletinLike(r) ? (allowsBulletins ? 0.18 : 0.55) : 0;
      const newsPenalty = !bulletinPenalty && isNewsLike(r) ? (allowsNews ? 0.04 : 0.16) : 0;
      const precisionQualified = matched.length > 0 || normSim >= 0.7;
      const weakEvidencePenalty = precisionQualified ? 0 : 0.12;
      const taste_score = 0.58 * normSim + 0.32 * normOverlap - 0.15 * normAnti + freshBonus - bulletinPenalty - newsPenalty - weakEvidencePenalty;
      const reasons = matched
        .sort((a, b) => b.w - a.w)
        .slice(0, 2)
        .map(m => m.tag);
      return { ...r, taste_score, reasons, precisionQualified };
    });

    // Sort by blended taste score, then diversify. News/public-affairs can appear,
    // but short bulletin feeds should never dominate a personal profile result.
    rows.sort((a, b) => (b.taste_score! - a.taste_score!));
    const perPod = new Map<string, number>();
    const finalRows: RecEp[] = [];
    let newsCount = 0;
    let bulletinCount = 0;
    const tryAdd = (r: RecEp & { precisionQualified?: boolean }, strict: boolean) => {
      const n = perPod.get(r.podcast_id) || 0;
      if (n >= 1) return false;
      const bulletin = isBulletinLike(r);
      const news = isNewsLike(r);
      if (strict && !r.precisionQualified) return false;
      if (bulletin && (!allowsBulletins || bulletinCount >= 1)) return false;
      if (news && newsCount >= (allowsNews ? 2 : 1)) return false;
      perPod.set(r.podcast_id, n + 1);
      if (bulletin) bulletinCount++;
      if (news) newsCount++;
      finalRows.push(r);
      return true;
    };
    for (const r of rows) {
      tryAdd(r, true);
      if (finalRows.length >= 12) break;
    }
    for (const r of rows) {
      if (finalRows.some((existing) => existing.episode_id === r.episode_id)) continue;
      tryAdd(r, false);
      if (finalRows.length >= 16) break;
    }
    // Never leave the finished profile with an empty recommendation shelf.
    // Keep the hard bulletin/news caps, but allow high-vector non-bulletin
    // matches even when the database lacks topic labels for the episode.
    for (const r of rows) {
      if (finalRows.length >= 8) break;
      if (finalRows.some((existing) => existing.episode_id === r.episode_id)) continue;
      const n = perPod.get(r.podcast_id) || 0;
      if (n >= 1) continue;
      if (isBulletinLike(r)) continue;
      if (!allowsNews && isNewsLike(r)) continue;
      if ((r.taste_score ?? 0) < 0.42 && (r.similarity ?? 0) < 0.62) continue;
      perPod.set(r.podcast_id, n + 1);
      finalRows.push(r);
    }
    setRecs(finalRows);
    setRecsLoading(false);
  };

  // Preview of next 2 cards behind the active one (visual stack)
  const upcoming = useMemo(() => {
    if (!pool || !current) return [] as Card[];
    const seen = new Set([...persisted.seenCardIds, current.id]);
    const out: Card[] = [];
    let tempLiked = effectiveLiked;
    let tempDisliked = disliked;
    let idx = totalSwipes + 1;
    for (let i = 0; i < 2; i++) {
      const c = pickNextCard(pool, seen, tempLiked, tempDisliked, idx, persisted.sessionId, sessionDomainOrder);
      if (!c) break;
      out.push(c);
      seen.add(c.id);
      idx++;
    }
    return out;
  }, [pool, current, persisted.seenCardIds, effectiveLiked, disliked, totalSwipes, persisted.sessionId, sessionDomainOrder]);

  /* ─────── Actions ─────── */

  const handleStart = () => {
    snapshotUtmFromUrl();
    trackLandingEvent("SwipeStarted");
    setPhase("swipe");
  };

  const finishSwipe = (
    reason: string,
    total = totalSwipes,
    positives = positiveSwipes,
    base: Persisted = persisted,
  ) => {
    const completed: Persisted = {
      ...base,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    savePersisted(completed);
    setPersisted(completed);
    setCurrent(null);
    completedRef.current = true;
    trackLandingEvent("SwipeCompleted", { total, positives, reason });
    trackProfileEvent("swipe_completed", { total, positives, reason });
    setPhase("result");
  };

  const handleSwipe = (action: SwipeAction) => {
    if (!current || !pool) return;
    if (!firstActionRef.current) {
      firstActionRef.current = true;
      trackLandingEvent("SwipeFirstAction", { action });
    }
    const isPositive = action === "like" || action === "super";
    const next: Persisted = {
      ...persisted,
      seenCardIds: [...persisted.seenCardIds, current.id],
      likedCardIds: isPositive ? [...persisted.likedCardIds, current.id] : persisted.likedCardIds,
      dislikedCardIds: action === "skip" ? [...persisted.dislikedCardIds, current.id] : persisted.dislikedCardIds,
      superLikedCardIds: action === "super" ? [...persisted.superLikedCardIds, current.id] : persisted.superLikedCardIds,
      cardSnapshots: {
        ...(persisted.cardSnapshots || {}),
        [current.id]: snapshotCard(current),
      },
      updatedAt: new Date().toISOString(),
    };
    setPersisted(next);
    savePersisted(next);
    setLastSwipeFeedback(swipeFeedback(action, next.seenCardIds.length));

    // Mild haptic feedback (mobile)
    try { (navigator as any).vibrate?.(action === "super" ? [10, 40, 30] : 15); } catch { /* ignore */ }

    // Build updated arrays for stop check with the same weighting as the result.
    const newLiked = isPositive ? [...liked, current] : liked;
    const newSuper = action === "super" ? [...superLiked, current] : superLiked;
    const newEffective = buildEffectiveLiked(newLiked, newSuper);
    const newDisliked = action === "skip" ? [...disliked, current] : disliked;
    const newConf = computeConfidence(newEffective, newDisliked);
    const total = next.seenCardIds.length;
    const positives = next.likedCardIds.length;

    // Drop-off telemetry — fire at fixed milestones so we can see WHERE users quit.
    if ([3, 5, 8, 10, 15, 20].includes(total)) {
      trackLandingEvent("SwipeProgress", { total, positives, action });
    }

    if (shouldCompleteTasteProfile(total, positives, newConf)) {
      finishSwipe("auto_confident", total, positives, next);
      return;
    }

    // Pick next card
    const seen = new Set(next.seenCardIds);
    const nextCard = pickNextCard(pool, seen, newEffective, newDisliked, total, next.sessionId, sessionDomainOrder);
    if (!nextCard) {
      finishSwipe("pool_exhausted", total, positives, next);
      return;
    }
    setCurrent(nextCard);
  };

  const resetAll = () => {
    const fresh: Persisted = {
      sessionId: crypto.randomUUID(),
      seenCardIds: [],
      likedCardIds: [],
      dislikedCardIds: [],
      superLikedCardIds: [],
      cardSnapshots: {},
      completedAt: null,
      updatedAt: new Date().toISOString(),
    };
    savePersisted(fresh);
    setPersisted(fresh);
    setCurrent(null);
    setRecs(null);
    completedRef.current = false;
    // Skip the intro screen entirely — no extra "Kezdjük" click, cards start immediately.
    snapshotUtmFromUrl();
    trackLandingEvent("SwipeStarted", { source: "reset" });
    trackProfileEvent("swipe_started", { source: "reset" });
    setPhase("swipe");
  };

  /* ─────── Render ─────── */

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-xl px-4 pt-6 pb-32 md:pt-10">
        <header className="mb-6 flex items-center justify-between">
          <Link
            to="/"
            aria-label="Podiverzum – főoldal"
            className="group inline-flex items-center gap-2"
          >
            <span className="relative inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-md bg-black ring-1 ring-white/10">
              <img src="/icon-512.png" alt="" width={28} height={28} className="object-contain" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors">
              Podiverzum
            </span>
          </Link>
          {totalSwipes > 0 && (
            <button
              onClick={resetAll}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <RotateCcw className="h-3 w-3" /> Újrakezdés
            </button>
          )}
        </header>

        <div className="mb-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> A Te Podiverzumod
          </div>
        </div>

        {phase === "intro" && (
          <IntroLanding
            onStart={handleStart}
            poolReady={!!pool && pool.length > 0}
            poolError={poolError}
            poolSize={pool?.length || 0}
            hasProgress={totalSwipes > 0}
            onContinue={() => setPhase(totalSwipes >= 10 ? "result" : "swipe")}
          />
        )}

        {phase === "swipe" && (
          <SwipeView
            current={current}
            upcoming={upcoming}
            loading={!pool}
            poolError={poolError}
            onRetry={() => {
              setPool(null);
              setCurrent(null);
              setPoolLoadNonce((n) => n + 1);
            }}
            totalSwipes={totalSwipes}
            positiveSwipes={positiveSwipes}
            superSwipes={superSwipes}
            confidence={confidence}
            feedback={lastSwipeFeedback}
            canFinish={totalSwipes >= 8 && positiveSwipes >= 4}
            onFinish={() => finishSwipe("user_ready")}
            onAction={handleSwipe}
          />
        )}

        {phase === "result" && (
          persisted.likedCardIds.length > 0 && liked.length === 0 ? (
            <div className="rounded-3xl border border-border bg-card p-8 text-center">
              <Skeleton className="mx-auto h-28 w-48 rounded-2xl" />
              <h1 className="mt-5 text-2xl font-semibold">Visszatöltjük a profilodat</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                A korábbi döntéseid megvannak, csak frissítjük hozzájuk a kártyaadatokat.
              </p>
            </div>
          ) : (
            <ResultView
              liked={liked}
              disliked={disliked}
              superLiked={superLiked}
              recs={recs}
              recsLoading={recsLoading}
              recsError={recsError}
              onRetryRecs={() => {
                setRecs(null);
                void fetchRecs();
              }}
              onReset={resetAll}
              onOpen={(p, e) => navigate(`/podcast/${p}/${e}`)}
            />
          )
        )}
      </div>
    </div>
  );
}

/* ────────────────── Intro ────────────────── */

function IntroLanding({
  onStart, poolReady, poolError, poolSize, hasProgress, onContinue,
}: {
  onStart: () => void;
  poolReady: boolean;
  poolError: string | null;
  poolSize: number;
  hasProgress: boolean;
  onContinue: () => void;
}) {
  return (
    <div>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
        A Te Podiverzumod
      </h1>
      <p className="mt-3 text-base text-muted-foreground">
        Mutatunk pár kártyát. Jobbra húzd, ami érdekel — balra, ami nem. Pár perc, és megépítjük a személyes hallgatási profilodat.
      </p>

      <div className="mt-8 space-y-3">
        <Button onClick={onStart} disabled={!poolReady} size="lg" className="w-full">
          {poolReady ? <>Kezdjük <ArrowRight className="ml-2 h-4 w-4" /></> : "Kártyák betöltése…"}
        </Button>
        {hasProgress && poolReady && (
          <Button onClick={onContinue} variant="secondary" size="lg" className="w-full">
            Folytatom, ahol abbahagytam
          </Button>
        )}
        {poolError && (
          <p className="text-xs text-destructive">Hiba a betöltéskor: {poolError}</p>
        )}
      </div>

      <div className="mt-10 grid grid-cols-3 gap-3 text-xs text-muted-foreground">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="font-medium text-foreground">← Balra</div>
          <div className="mt-1">Most nem</div>
        </div>
        <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
          <div className="font-medium text-primary">↑ Fel</div>
          <div className="mt-1">Imádom</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="font-medium text-foreground">Jobbra →</div>
          <div className="mt-1">Érdekel</div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────── Swipe ────────────────── */

function SwipeView({
  current, upcoming, loading, poolError, onRetry, totalSwipes, positiveSwipes, superSwipes, confidence, feedback, canFinish, onFinish, onAction,
}: {
  current: Card | null;
  upcoming: Card[];
  loading: boolean;
  poolError: string | null;
  onRetry: () => void;
  totalSwipes: number;
  positiveSwipes: number;
  superSwipes: number;
  confidence: number;
  feedback: string | null;
  canFinish: boolean;
  onFinish: () => void;
  onAction: (a: SwipeAction) => void;
}) {
  // Keyboard shortcuts
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") { e.preventDefault(); onAction("like"); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); onAction("skip"); }
      else if (e.key === "ArrowUp") { e.preventDefault(); onAction("super"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, onAction]);

  if (poolError) {
    return (
      <div className="rounded-3xl border border-border bg-card p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold">Nem jöttek be a kártyák</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ez nem nálad van. Próbáljuk újra, és ha kell, rögtön új kártyacsomagot kérünk.
        </p>
        <Button onClick={onRetry} className="mt-5 w-full">
          Újrapróbálom
        </Button>
      </div>
    );
  }
  if (loading) {
    return (
      <div>
        <div className="mb-5">
          <h1 className="text-3xl font-semibold tracking-tight">Építsd fel A Te Podiverzumod</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Töltjük a kártyákat. Csak azt kell jelezned, mi érdekel és mi nem.
          </p>
        </div>
        <Skeleton className="mx-auto aspect-[3/4] h-[min(60svh,30rem)] rounded-3xl" />
      </div>
    );
  }
  if (!current) {
    return (
      <div className="rounded-3xl border border-border bg-card p-8 text-center text-muted-foreground">
        Nincs több kártya — most jönnek az ajánlások.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-3xl font-semibold tracking-tight">Építsd fel A Te Podiverzumod</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Jobbra, ha érdekel. Balra, ha most nem. Fel, ha nagyon betalált.
        </p>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{tasteProgressCopy(totalSwipes, positiveSwipes, confidence)}</span>
        <span className="shrink-0">{totalSwipes} döntés</span>
      </div>
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full bg-gradient-to-r from-primary to-primary/70"
          initial={false}
          animate={{ width: `${Math.min(100, Math.max(8, Math.round((totalSwipes / 10) * 100)))}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 18 }}
        />
      </div>
      <AnimatePresence mode="popLayout">
        {feedback && (
          <motion.div
            key={feedback}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="mb-3 rounded-full border border-primary/20 bg-primary/10 px-3 py-2 text-center text-xs font-medium text-primary"
          >
            {feedback}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative mx-auto aspect-[3/4] h-[min(60svh,30rem)] max-w-full">
        {/* Background stack (next cards) */}
        {upcoming.map((c, i) => {
          const depth = i + 1; // 1, 2
          return (
            <motion.div
              key={c.id}
              className="absolute inset-0 pointer-events-none"
              initial={false}
              animate={{
                scale: 1 - depth * 0.05,
                y: depth * 12,
                opacity: 1 - depth * 0.35,
              }}
              transition={{ type: "spring", stiffness: 200, damping: 22 }}
              style={{ zIndex: 10 - depth }}
            >
              <div className="absolute inset-0 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/20 via-card to-card shadow-lg">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.1),transparent_60%)]" />
              </div>
            </motion.div>
          );
        })}

        {/* Active card */}
        <AnimatePresence mode="popLayout" initial={false}>
          <SwipeCard key={current.id} card={current} onAction={onAction} />
        </AnimatePresence>
      </div>

      <div className="mt-6 flex items-center justify-center gap-5">
        <ActionBtn label="Most nem" onClick={() => onAction("skip")} variant="skip">
          <X className="h-7 w-7" />
        </ActionBtn>
        <ActionBtn label="Imádom" onClick={() => onAction("super")} variant="super">
          <Star className="h-6 w-6 fill-current" />
        </ActionBtn>
        <ActionBtn label="Érdekel" onClick={() => onAction("like")} variant="like">
          <Heart className="h-7 w-7 fill-current" />
        </ActionBtn>
      </div>
      <div className="mt-3 text-center text-[10px] uppercase tracking-wider text-muted-foreground">
        Balra: most nem · Fel: imádom · Jobbra: érdekel
      </div>
      {canFinish && (
        <button
          type="button"
          onClick={onFinish}
          className="mx-auto mt-4 flex items-center justify-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-medium text-primary hover:bg-primary/15"
        >
          Mutasd az ajánlásokat <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function SwipeCard({ card, onAction }: { card: Card; onAction: (a: SwipeAction) => void }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Rotation follows horizontal drag, clamped
  const rotate = useTransform(x, [-300, 0, 300], [-18, 0, 18]);

  // Stamp opacities
  const likeOpacity = useTransform(x, [40, 160], [0, 1]);
  const nopeOpacity = useTransform(x, [-160, -40], [1, 0]);
  const superOpacity = useTransform(y, [-160, -40], [1, 0]);

  // Color overlay tints
  const greenTint = useTransform(x, [40, 200], [0, 0.35]);
  const redTint = useTransform(x, [-200, -40], [0.35, 0]);
  const blueTint = useTransform(y, [-200, -40], [0.4, 0]);

  const handleDragEnd = (_: any, info: PanInfo) => {
    const { offset, velocity } = info;
    // Super-like takes precedence when up-swipe dominates
    if (offset.y < -140 || velocity.y < -700) return onAction("super");
    if (offset.x > 120 || velocity.x > 600) return onAction("like");
    if (offset.x < -120 || velocity.x < -600) return onAction("skip");
  };

  // Exit animation: fly off in the direction of the last drag (or current motion)
  const exitFor = (cx: number, cy: number) => {
    if (cy < -100) return { y: -800, opacity: 0, rotate: 0, transition: { duration: 0.35 } };
    if (cx > 80) return { x: 800, rotate: 24, opacity: 0, transition: { duration: 0.35 } };
    if (cx < -80) return { x: -800, rotate: -24, opacity: 0, transition: { duration: 0.35 } };
    return { opacity: 0, scale: 0.9, transition: { duration: 0.2 } };
  };

  return (
    <motion.div
      className="absolute inset-0"
      drag
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={0.85}
      onDragEnd={handleDragEnd}
      whileTap={{ cursor: "grabbing" }}
      style={{ x, y, rotate, cursor: "grab", zIndex: 20 }}
      initial={{ scale: 0.92, opacity: 0, y: 30 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={exitFor(x.get(), y.get())}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
    >
      <div className="absolute inset-0 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/30 via-card to-card shadow-2xl">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.15),transparent_60%)]" />

        {/* Color overlays */}
        <motion.div className="pointer-events-none absolute inset-0 bg-emerald-500" style={{ opacity: greenTint }} />
        <motion.div className="pointer-events-none absolute inset-0 bg-rose-500" style={{ opacity: redTint }} />
        <motion.div className="pointer-events-none absolute inset-0 bg-sky-400" style={{ opacity: blueTint }} />

        {/* LIKE stamp */}
        <motion.div
          className="pointer-events-none absolute left-6 top-6 select-none"
          style={{ opacity: likeOpacity, rotate: -12 }}
        >
          <div className="rounded-md border-4 border-emerald-400 px-3 py-1 text-2xl font-black uppercase tracking-widest text-emerald-400 shadow-lg">
            Tetszik
          </div>
        </motion.div>

        {/* NOPE stamp */}
        <motion.div
          className="pointer-events-none absolute right-6 top-6 select-none"
          style={{ opacity: nopeOpacity, rotate: 12 }}
        >
          <div className="rounded-md border-4 border-rose-500 px-3 py-1 text-2xl font-black uppercase tracking-widest text-rose-500 shadow-lg">
            Most nem
          </div>
        </motion.div>

        {/* SUPER stamp */}
        <motion.div
          className="pointer-events-none absolute left-1/2 top-10 -translate-x-1/2 select-none"
          style={{ opacity: superOpacity }}
        >
          <div className="rounded-md border-4 border-sky-400 px-4 py-1 text-2xl font-black uppercase tracking-widest text-sky-400 shadow-lg">
            ⭐ Imádom
          </div>
        </motion.div>

        <div className="relative flex h-full flex-col justify-end p-5 sm:p-6">
          <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {card.stage === "broad" ? "felfedezés" : card.stage === "refine" ? "finomítás" : card.stage === "style" ? "stílus" : "ellenőrzés"}
          </div>
          <h2 className="text-xl font-semibold leading-snug text-foreground sm:text-2xl">
            {card.title}
          </h2>
          {card.subtitle && (
            <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{card.subtitle}</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ActionBtn({
  children, label, onClick, variant,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  variant: "like" | "skip" | "super";
}) {
  const styles =
    variant === "like"
      ? "h-16 w-16 bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/30"
      : variant === "super"
      ? "h-14 w-14 bg-sky-500 text-white hover:bg-sky-400 shadow-lg shadow-sky-500/30"
      : "h-16 w-16 bg-card border border-border hover:bg-muted text-foreground";
  return (
    <motion.button
      onClick={onClick}
      aria-label={label}
      className={`${styles} rounded-full flex items-center justify-center`}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.9 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
    >
      {children}
    </motion.button>
  );
}

/* ────────────────── Result ────────────────── */

function ResultView({
  liked, disliked, superLiked, recs, recsLoading, recsError, onRetryRecs, onReset, onOpen,
}: {
  liked: Card[];
  disliked: Card[];
  superLiked: Card[];
  recs: RecEp[] | null;
  recsLoading: boolean;
  recsError: string | null;
  onRetryRecs: () => void;
  onReset: () => void;
  onOpen: (p: string, e: string) => void;
}) {
  useEffect(() => { trackLandingEvent("ResultViewed"); }, []);
  useEffect(() => { trackLandingEvent("RegistrationOffered"); }, []);
  // TODO(ai-copy): behind a future feature flag, swap deterministic copy below with
  // a `personalize-profile` edge function call that uses Lovable AI Gateway.

  // Match the page-level weighting: super-likes 3x (stronger personalization).
  const effectiveLiked = useMemo(
    () => buildEffectiveLiked(liked, superLiked),
    [liked, superLiked],
  );
  const weights = useMemo(() => tagWeights(effectiveLiked), [effectiveLiked]);
  const archetype = useMemo(() => pickArchetype(weights), [weights]);
  const topInterests = useMemo(() => topTags(weights, 5), [weights]);
  const topInterestLabels = useMemo(() => topInterests.slice(0, 3).map(tagLabel), [topInterests]);

  // ── Aura: mood-tag-weighted color palette (super-likes 3x)
  const moodWeights = useMemo(() => {
    const w: Record<string, number> = {};
    for (const c of liked) for (const t of c.mood_tags) w[t] = (w[t] || 0) + 1;
    for (const c of superLiked) for (const t of c.mood_tags) w[t] = (w[t] || 0) + 3;
    return w;
  }, [liked, superLiked]);
  const aura = useMemo(() => buildAura(moodWeights), [moodWeights]);

  // ── Constellation: top topic_tags as stars, super-likes brighter
  const seedKey = useMemo(() => {
    const ids = [...liked, ...superLiked].map(c => c.id).sort().join("|");
    return ids || "empty";
  }, [liked, superLiked]);
  const topicStars = useMemo(() => {
    const w: Record<string, { weight: number; superCount: number }> = {};
    for (const c of liked) for (const t of c.topic_tags) {
      w[t] = w[t] || { weight: 0, superCount: 0 };
      w[t].weight += 1;
    }
    for (const c of superLiked) for (const t of c.topic_tags) {
      w[t] = w[t] || { weight: 0, superCount: 0 };
      w[t].weight += 3;
      w[t].superCount += 1;
    }
    return Object.entries(w)
      .map(([label, v]) => ({ label, weight: v.weight, superCount: v.superCount }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 7);
  }, [liked, superLiked]);
  const constellation = useMemo(() => buildConstellation(topicStars, seedKey), [topicStars, seedKey]);
  const element = useMemo(() => buildElement(moodWeights), [moodWeights]);
  const topMoodKeys = useMemo(
    () => Object.entries(moodWeights).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k.toLowerCase()),
    [moodWeights],
  );
  const verdict = useMemo(
    () => buildVerdict(seedKey, {
      topMoods: topMoodKeys,
      topTopics: topicStars.slice(0, 2).map(s => s.label),
      archetypeName: archetype.name,
      archetypeId: archetype.id,
      element: element.key,
    }),
    [seedKey, topMoodKeys, topicStars, archetype.name, archetype.id, element.key],
  );

  const pdvCode = useMemo(() => buildPdvCode(seedKey), [seedKey]);

  // Recommended podcasts: dedupe from recs
  const recPodcasts = useMemo(() => {
    if (!recs) return [];
    const seen = new Set<string>();
    const out: Array<{ id: string; title: string; slug: string; image: string | null }> = [];
    for (const r of recs) {
      if (seen.has(r.podcast_id)) continue;
      seen.add(r.podcast_id);
      out.push({ id: r.podcast_id, title: r.podcast_title, slug: r.podcast_slug, image: r.podcast_image_url });
      if (out.length >= 5) break;
    }
    return out;
  }, [recs]);

  // Új listener profile (a régi archetype id-ből mappingelve), ez kerül a receiptre.
  const listenerProfile = useMemo(() => profileForArchetypeId(archetype.id), [archetype.id]);
  const receiptRef = useRef<HTMLDivElement>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const receiptNumber = useMemo(
    () => buildReceiptNumber(shareId || pdvCode || listenerProfile.id),
    [shareId, pdvCode, listenerProfile.id],
  );
  const [busy, setBusy] = useState<null | "share" | "download" | "copy">(null);
  const [showShareHint, setShowShareHint] = useState(false);

  // Fire `profile_generated` once when the result mounts.
  useEffect(() => {
    trackProfileEvent("profile_generated", {
      archetype_id: listenerProfile.id,
      source_profile_id: getSourceProfileId(),
    });
    // If user came via ?ref=... ez a "second generation" event.
    if (getSourceProfileId()) {
      trackProfileEvent("second_generation_from_shared_profile", {
        archetype_id: listenerProfile.id,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Egyszer hoz létre egy share rekordot — utána cache-elve használjuk. */
  const ensureShare = async (): Promise<{ url: string; share_id: string } | null> => {
    if (shareUrl && shareId) return { url: shareUrl, share_id: shareId };
    const payload = {
      result_type: listenerProfile.id,
      result_title: listenerProfile.name,
      result_subtitle: listenerProfile.recommendedDirection,
      result_description: `${listenerProfile.name} — ${listenerProfile.traits.join(" · ")}`,
      tags: listenerProfile.traits,
      aura_colors: aura.colors.slice(0, 4),
    };
    const res = await fetch(SHARE_FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const { url, share_id } = (await res.json()) as { url: string; share_id: string };
    // Új kanonikus share URL: /hallgatoi-profil/:shareId
    const canonical = `https://podiverzum.hu/hallgatoi-profil/${share_id}`;
    setShareUrl(canonical);
    setShareId(share_id);
    notifyLiveEvent("swipe_complete", {
      archetype: listenerProfile.name,
      result_title: listenerProfile.name,
      share_url: canonical,
    });
    return { url: canonical, share_id };
  };

  const handleShare = async () => {
    if (busy) return;
    setBusy("share");
    trackLandingEvent("ResultShared");
    trackProfileEvent("profile_share_clicked", { archetype_id: listenerProfile.id });
    try {
      const created = await ensureShare();
      if (!created) {
        toast.error("Nem sikerült létrehozni a megosztható linket.");
        return;
      }
      const { url, share_id } = created;
      const outcome = await shareProfileLink({
        title: `${listenerProfile.name} lettem a Podiverzumon`,
        text: "Pár döntésből kiderül, milyen podcast-hallgató vagy. Neked mi jön ki?",
        url,
      });
      if (outcome === "shared") {
        toast.success("Megosztva");
        setShowShareHint(true);
      } else if (outcome === "copied") {
        toast.success("Link másolva");
        trackProfileEvent("profile_link_copied", {
          share_id,
          archetype_id: listenerProfile.id,
        });
        setShowShareHint(true);
      } else if (outcome === "error") {
        toast.error("Hoppá, valami félrement.");
      }
    } catch (e) {
      console.error("[share] error", e);
      toast.error("Hoppá, valami félrement.");
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async () => {
    if (busy) return;
    setBusy("download");
    try {
      const created = await ensureShare();
      if (!receiptRef.current) return;
      const blob = await renderReceiptPng(receiptRef.current, "story");
      downloadReceipt(blob, `podiverzum-${listenerProfile.id}.png`);
      trackProfileEvent("profile_image_downloaded", {
        share_id: created?.share_id ?? null,
        archetype_id: listenerProfile.id,
      });
      toast.success("Kép mentve");
    } catch {
      toast.error("Nem sikerült a mentés.");
    } finally {
      setBusy(null);
    }
  };

  const handleCopyLink = async () => {
    if (busy) return;
    setBusy("copy");
    try {
      const created = await ensureShare();
      if (!created) {
        toast.error("Nem sikerült létrehozni a linket.");
        return;
      }
      const copied = await copyText(created.url);
      if (!copied) throw new Error("copy failed");
      trackProfileEvent("profile_link_copied", {
        share_id: created.share_id,
        archetype_id: listenerProfile.id,
      });
      toast.success("Link másolva");
      setShowShareHint(true);
    } catch {
      toast.error("Nem sikerült a vágólapra másolás.");
    } finally {
      setBusy(null);
    }
  };

  if (liked.length === 0) {
    return (
      <div className="rounded-3xl border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">Egyetlen lájk sem érkezett — próbáljuk újra?</p>
        <Button onClick={onReset} className="mt-4">Új kártyák</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero: Hallgatói profil nyugta — a viral megosztó tárgy */}
      <div className="rounded-3xl border border-border bg-card p-4 md:p-8">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            A hallgatói profilod
          </div>
          <h2 className="mt-1 text-2xl font-semibold md:text-3xl">
            {listenerProfile.name}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            {topInterestLabels.length > 0
              ? `A profilod legerősebb jelei: ${topInterestLabels.join(", ")}.`
              : listenerProfile.recommendedDirection}
          </p>
        </div>

        <div className="mt-6 flex justify-center overflow-hidden">
          <ListenerReceipt
            ref={receiptRef}
            profile={listenerProfile}
            receiptNumber={receiptNumber}
            seed={shareId || pdvCode}
          />
        </div>

        <div className="mt-6 space-y-3">
          <Button onClick={handleShare} size="lg" className="w-full" disabled={busy !== null}>
            <Share2 className="mr-2 h-4 w-4" />
            {busy === "share" ? "Készítem…" : "Megosztás"}
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            Mobilon ez a telefon megosztóablakát nyitja meg; onnan válaszd az Instagramot vagy Facebookot.
          </p>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <Button onClick={handleDownload} variant="secondary" size="sm" disabled={busy !== null}>
              <Download className="mr-1.5 h-4 w-4" /> Kép
            </Button>
            <Button onClick={handleCopyLink} variant="secondary" size="sm" disabled={busy !== null}>
              <Link2 className="mr-1.5 h-4 w-4" /> Link
            </Button>
            <Button onClick={onReset} variant="ghost" size="sm">
              <RotateCcw className="mr-1.5 h-4 w-4" /> Újra
            </Button>
          </div>
          {showShareHint && (
            <p className="text-center text-xs text-muted-foreground">
              Most jön a jó rész: nézd meg, a barátaidnak milyen hallgatói profil jön ki.
            </p>
          )}
        </div>

      </div>

      {/* Recommended episodes */}
      <div id="ajanlott-epizodok" className="scroll-mt-6">
        <h3 className="mb-3 text-lg font-semibold">Neked ajánlott epizódok</h3>
        {recsLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
          </div>
        )}
        {!recsLoading && recs && recs.length > 0 && (
          <div className="space-y-3">
            <Button onClick={() => onOpen(recs[0].podcast_slug, recs[0].slug)} size="lg" className="w-full">
              <Play className="mr-2 h-4 w-4" />
              Indítsd az első ajánlást
            </Button>
            {recs.map(r => (
              <button
                key={r.episode_id}
                onClick={() => onOpen(r.podcast_slug, r.slug)}
                className="group flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted"
              >
                <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl">
                  {(() => {
                    const src = r.image_url || r.podcast_image_url;
                    return src ? (
                      <img
                        src={optimizedImageUrl(src, { width: 112, height: 112 }) || src}
                        srcSet={imageSrcSet(src, [80, 112, 160])}
                        sizes="80px"
                        alt=""
                        loading="lazy"
                        decoding="async"
                        width={112}
                        height={112}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-muted" />
                    );
                  })()}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                    <Play className="h-6 w-6 fill-white text-white" />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs uppercase tracking-wider text-muted-foreground">{r.podcast_title}</div>
                  <div className="line-clamp-2 font-medium">{r.display_title || r.title}</div>
                  {sanitizeHungarianPublicText(r.ai_summary) && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {sanitizeHungarianPublicText(r.ai_summary)}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                      <Sparkles className="h-3 w-3" />
                      {mysticMatch(r.taste_score ?? r.similarity, recs!.indexOf(r))}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      <ThumbsUp className="h-3 w-3" />
                      {primaryReason(r)}
                    </span>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 flex-shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </button>
            ))}
          </div>
        )}
        {!recsLoading && recsError && (
          <div className="rounded-2xl border border-border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Friss magyar epizódokat készítünk elő a profilodhoz.
            </p>
            <Button onClick={onRetryRecs} variant="secondary" className="mt-4">
              Frissítem az ajánlásokat
            </Button>
          </div>
        )}
        {!recsLoading && !recsError && (!recs || recs.length === 0) && (
          <div className="rounded-2xl border border-border bg-card p-6 text-center text-muted-foreground">
            Még tanuljuk az ízlésedet — swipe-olj párat újra.
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-border bg-card p-5">
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Miért ezt kaptad?
        </div>
        <div className="mt-3 space-y-2 text-sm text-foreground/85">
          <div className="flex gap-2">
            <span className="text-primary">01</span>
            <span>{liked.length + superLiked.length} pozitív jel alapján épült a profilod.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-primary">02</span>
            <span>
              {topInterestLabels.length > 0
                ? `A legerősebb érdeklődési irányaid: ${topInterestLabels.join(", ")}.`
                : listenerProfile.recommendedDirection}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="text-primary">03</span>
            <span>A „most nem” húzások is számítanak, hogy ne generikus ajánlót kapj.</span>
          </div>
        </div>
      </div>


      {/* Constellation */}
      {constellation.stars.length >= 3 && (
        <ConstellationVisual constellation={constellation} accent={aura.primary} />
      )}

      {/* Recommended podcasts */}
      {recPodcasts.length > 0 && (
        <div>
          <h3 className="mb-3 text-lg font-semibold">Podcastok, amik passzolnak</h3>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {recPodcasts.map(p => (
              <Link
                key={p.id}
                to={`/podcast/${p.slug}`}
                className="group flex-shrink-0 w-32"
              >
                <div className="aspect-square overflow-hidden rounded-2xl border border-border bg-muted">
                  {p.image ? (
                    <img
                      src={optimizedImageUrl(p.image, { width: 160, height: 160 }) || p.image}
                      srcSet={imageSrcSet(p.image, [128, 160, 240])}
                      sizes="128px"
                      alt={p.title}
                      loading="lazy"
                      decoding="async"
                      width={160}
                      height={160}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : null}
                </div>
                <div className="mt-2 line-clamp-2 text-xs">{p.title}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <EmailCaptureCard archetypeSlug={archetype.id} />

      <SoftAuthCTA
        archetypeSlug={archetype.id}
        archetypeResult={{
          name: archetype.name,
          result_type: listenerProfile.id,
          result_title: listenerProfile.name,
          result_subtitle: listenerProfile.recommendedDirection,
          result_description: `${listenerProfile.name} — ${listenerProfile.traits.join(" · ")}`,
          tags: topInterestLabels,
          element: element.key,
          aura: aura.essence,
          topInterests,
          pdvCode,
        }}
      />

      <div className="text-center text-xs text-muted-foreground">
        {liked.length} ❤ {superLiked.length > 0 && <>· <span className="text-primary">{superLiked.length} ⭐</span> </>}· {disliked.length} ❌ — a profilod helyben tárolódik
      </div>
    </div>
  );
}

/* ────────────────── Aura visual ────────────────── */

function AuraVisual({ colors }: { colors: string[] }) {
  // Up to 4 morphing radial gradients overlaid on a dark canvas.
  // Each blob slowly drifts with framer-motion for an organic feel.
  const pad = (arr: string[]) => (arr.length >= 3 ? arr : [...arr, ...arr, ...arr]).slice(0, 4);
  const palette = pad(colors);
  const blobs = [
    { from: { x: "10%", y: "20%" }, to: { x: "30%", y: "40%" }, size: 70 },
    { from: { x: "75%", y: "30%" }, to: { x: "60%", y: "55%" }, size: 60 },
    { from: { x: "30%", y: "75%" }, to: { x: "45%", y: "60%" }, size: 65 },
    { from: { x: "80%", y: "80%" }, to: { x: "70%", y: "65%" }, size: 55 },
  ];
  return (
    <div className="absolute inset-0" style={{ backgroundColor: "#0a0a0f" }}>
      {blobs.map((b, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          initial={{ left: b.from.x, top: b.from.y, opacity: 0 }}
          animate={{
            left: [b.from.x, b.to.x, b.from.x],
            top: [b.from.y, b.to.y, b.from.y],
            opacity: 0.85,
          }}
          transition={{
            left: { duration: 14 + i * 2, repeat: Infinity, ease: "easeInOut" },
            top: { duration: 16 + i * 2, repeat: Infinity, ease: "easeInOut" },
            opacity: { duration: 1.2, delay: i * 0.15 },
          }}
          style={{
            width: `${b.size}%`,
            height: `${b.size}%`,
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(circle, ${palette[i]} 0%, transparent 65%)`,
            filter: "blur(40px)",
            mixBlendMode: "screen",
          }}
        />
      ))}
      {/* Subtle grain for premium feel */}
      <div
        className="absolute inset-0 opacity-[0.08] mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence baseFrequency='0.9'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />
    </div>
  );
}

/* ────────────────── Constellation visual ────────────────── */

function ConstellationVisual({
  constellation,
  accent,
}: {
  constellation: ReturnType<typeof import("@/lib/podiverzumProfile").buildConstellation>;
  accent: string;
}) {
  const W = 600;
  const H = 320;
  return (
    <div className="rounded-3xl border border-border bg-[#0a0a0f] p-5 md:p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-white/50">
            A te konstellációd
          </div>
          <div className="mt-0.5 font-serif text-xl text-white md:text-2xl">
            {constellation.name}
          </div>
        </div>
        <div className="text-xs text-white/40">
          {constellation.stars.length} csillag
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        style={{ filter: `drop-shadow(0 0 12px ${accent})` }}
      >
        {/* Background micro-stars */}
        {Array.from({ length: 50 }).map((_, i) => {
          const x = ((i * 137) % W);
          const y = ((i * 53) % H);
          const r = 0.4 + ((i * 13) % 10) / 18;
          return <circle key={`bg-${i}`} cx={x} cy={y} r={r} fill="white" opacity={0.25} />;
        })}

        {/* Edges */}
        {constellation.edges.map(([a, b], i) => {
          const sa = constellation.stars[a];
          const sb = constellation.stars[b];
          return (
            <motion.line
              key={`e-${i}`}
              x1={sa.x * W}
              y1={sa.y * H}
              x2={sb.x * W}
              y2={sb.y * H}
              stroke={accent}
              strokeWidth={0.7}
              strokeOpacity={0.6}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.6 }}
              transition={{ duration: 1.2, delay: 0.6 + i * 0.15, ease: "easeOut" }}
            />
          );
        })}

        {/* Stars */}
        {constellation.stars.map((s, i) => (
          <g key={`s-${i}`}>
            <motion.circle
              cx={s.x * W}
              cy={s.y * H}
              r={s.radius}
              fill="white"
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{
                opacity: [s.brightness * 0.7, s.brightness, s.brightness * 0.7],
                scale: 1,
              }}
              transition={{
                opacity: { duration: 3 + (i % 3), repeat: Infinity, ease: "easeInOut" },
                scale: { duration: 0.5, delay: i * 0.12 },
              }}
              style={{ filter: `drop-shadow(0 0 ${s.radius * 1.4}px white)` }}
            />
            <motion.text
              x={s.x * W}
              y={s.y * H + s.radius + 11}
              textAnchor="middle"
              fill="white"
              fillOpacity={0.7}
              fontSize={9}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.7 }}
              transition={{ duration: 0.6, delay: 1.4 + i * 0.1 }}
            >
              {s.label}
            </motion.text>
          </g>
        ))}
      </svg>
    </div>
  );
}
