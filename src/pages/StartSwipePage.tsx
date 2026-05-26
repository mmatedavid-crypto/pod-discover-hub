import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, PanInfo, useMotionValue, useTransform } from "framer-motion";
import { Heart, X, Sparkles, RotateCcw, ArrowRight, Share2, Play, Star, Instagram, Facebook } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Vec, zero, mean, sub, scale, add, cosine, coherence, normalize, toPgVector, parsePgVector,
} from "@/lib/tasteVector";
import { ARCHETYPES, pickArchetype, archetypeConfidence } from "@/lib/tasteArchetypes";
// (image share-card no longer used here; switched to public share-link flow)
import { buildAura, buildConstellation, buildVerdict, buildPdvCode, buildElement } from "@/lib/podiverzumProfile";
import { toast } from "sonner";
import { SoftAuthCTA } from "@/components/SoftAuthCTA";
import { EmailCaptureCard } from "@/components/EmailCaptureCard";
import { trackLandingEvent, snapshotUtmFromUrl } from "@/lib/landingEvents";
import { notifyLiveEvent } from "@/lib/liveTelegramNotify";
import { ListenerReceipt } from "@/components/receipt/ListenerReceipt";
import { profileForArchetypeId, buildReceiptNumber } from "@/lib/listenerProfiles";
import { renderReceiptPng, shareReceipt, downloadReceipt } from "@/lib/receiptImage";
import { trackProfileEvent, captureSourceProfileFromUrl, getSourceProfileId } from "@/lib/profileEvents";
import { Download, Link2 } from "lucide-react";

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

const STORAGE_KEY = "podiverzum_taste_v1";

type Persisted = {
  sessionId: string;
  seenCardIds: string[];
  likedCardIds: string[];
  dislikedCardIds: string[];
  superLikedCardIds: string[];
  updatedAt: string;
};

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        sessionId: p.sessionId || crypto.randomUUID(),
        seenCardIds: p.seenCardIds || [],
        likedCardIds: p.likedCardIds || [],
        dislikedCardIds: p.dislikedCardIds || [],
        superLikedCardIds: p.superLikedCardIds || [],
        updatedAt: p.updatedAt || new Date().toISOString(),
      };
    }
  } catch { /* ignore */ }
  return {
    sessionId: crypto.randomUUID(),
    seenCardIds: [],
    likedCardIds: [],
    dislikedCardIds: [],
    superLikedCardIds: [],
    updatedAt: new Date().toISOString(),
  };
}

function savePersisted(p: Persisted) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...p, updatedAt: new Date().toISOString() })); } catch { /* ignore */ }
}

/* ────────────────── Stopping logic ────────────────── */

function shouldStop(totalSwipes: number, positiveSwipes: number, confidence: number): boolean {
  if (totalSwipes >= 10 && positiveSwipes >= 6 && confidence >= 0.72) return true;
  if (totalSwipes >= 22 && positiveSwipes >= 5 && confidence >= 0.60) return true;
  if (totalSwipes >= 30) return true;
  return false;
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

function topTags(weights: Record<string, number>, n: number): string[] {
  return Object.entries(weights).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

/* ────────────────── Next-card selector ────────────────── */

const BROAD_DOMAINS = [
  "gazdaság", "közélet", "technológia", "pszichológia",
  "kultúra", "tudomány", "hit", "humor",
  "irodalom", "gasztronómia", "utazás", "bűnügy",
];


function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickWeighted<T>(items: { item: T; score: number }[]): T {
  // Softmax-like weighted random — favors top items but never deterministic
  const max = Math.max(...items.map(i => i.score));
  const weights = items.map(i => Math.exp((i.score - max) * 6));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
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
  domainOrder: string[] = BROAD_DOMAINS,
): Card | null {
  const candidates = pool.filter(c => !seen.has(c.id));
  if (candidates.length === 0) return null;

  // First 8 swipes: ensure broad coverage, rotate domains (order shuffled per session)
  if (swipeIdx < 8) {
    const wantedDomain = domainOrder[swipeIdx % domainOrder.length];
    const broadMatches = candidates.filter(
      c => c.stage === "broad" && (c.topic_tags.includes(wantedDomain) || c.archetype_tags.includes(wantedDomain))
    );
    if (broadMatches.length > 0) {
      const shuffled = shuffle(broadMatches);
      return shuffled[Math.floor(Math.random() * Math.min(5, shuffled.length))];
    }
    const anyBroad = shuffle(candidates.filter(c => c.stage === "broad"));
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
    const rand = Math.random();
    const score = 0.30 * uncertainty + 0.22 * relevance + 0.20 * coverageGap + 0.10 * disamb + 0.18 * rand;
    return { item: c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  // Weighted-random sample from the top 8 → keeps quality high but kills repeat sessions
  return pickWeighted(scored.slice(0, 8));
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
      if (p.likedCardIds.length >= 6 || p.seenCardIds.length >= 10) return "result";
    } catch { /* ignore */ }
    return "swipe";
  })();
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [pool, setPool] = useState<Card[] | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Card | null>(null);
  const [recs, setRecs] = useState<RecEp[] | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);

  // Derived collections
  const byId = useMemo(() => {
    const m = new Map<string, Card>();
    (pool || []).forEach(c => m.set(c.id, c));
    return m;
  }, [pool]);

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
    () => [...liked, ...superLiked, ...superLiked],
    [liked, superLiked],
  );

  const totalSwipes = persisted.seenCardIds.length;
  const positiveSwipes = persisted.likedCardIds.length;
  const superSwipes = persisted.superLikedCardIds.length;
  const confidence = useMemo(
    () => computeConfidence(effectiveLiked, disliked),
    [effectiveLiked, disliked]
  );

  // Load card pool once
  useEffect(() => {
    let cancelled = false;
    (async () => {
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
  }, []);

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
  const completedRef = useRef(false);
  useEffect(() => {
    if (phase !== "swipe") return;
    const fire = () => {
      if (completedRef.current) return;
      const total = persisted.seenCardIds.length;
      const positives = persisted.likedCardIds.length;
      if (total === 0) return; // never started swiping
      trackLandingEvent("SwipeAbandoned", { total, positives });
      completedRef.current = true; // only fire once
    };
    const onVis = () => { if (document.visibilityState === "hidden") fire(); };
    window.addEventListener("pagehide", fire);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", fire);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [phase, persisted.seenCardIds.length, persisted.likedCardIds.length]);

  // Pick first card when entering swipe phase
  useEffect(() => {
    if (phase !== "swipe" || !pool || current) return;
    const seen = new Set(persisted.seenCardIds);
    const next = pickNextCard(pool, seen, effectiveLiked, disliked, totalSwipes);
    setCurrent(next);
  }, [phase, pool, current, persisted.seenCardIds, effectiveLiked, disliked, totalSwipes]);

  // Auto-fetch recs when entering result
  useEffect(() => {
    if (phase !== "result" || recs || liked.length === 0) return;
    void fetchRecs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const fetchRecs = async () => {
    if (effectiveLiked.length === 0 || !pool) return;
    setRecsLoading(true);

    // Mean-center against the pool centroid so the user's *deviation* dominates.
    const centroid = mean(pool.map(c => c.card_embedding));
    const likedDev = mean(effectiveLiked.map(c => sub(c.card_embedding, centroid)));
    const dislikedDev = disliked.length
      ? mean(disliked.map(c => sub(c.card_embedding, centroid)))
      : zero(centroid.length);
    const direction = sub(likedDev, dislikedDev);
    const userVec = normalize(add(centroid, scale(direction, 2.5)));
    const negVec = disliked.length
      ? normalize(add(centroid, scale(dislikedDev, 2.5)))
      : null;

    // Over-fetch (40) so we have headroom for tag-overlap re-rank below.
    const { data, error } = await supabase.rpc("match_episodes_by_taste_vector", {
      p_user_vector: toPgVector(userVec) as any,
      p_negative_vector: negVec ? (toPgVector(negVec) as any) : null,
      p_exclude_episode_ids: [],
      p_limit: 40,
    });
    if (error || !data) { setRecsLoading(false); return; }

    // ── Build the user's "taste fingerprint" from their swipes:
    // top topic / mood / archetype tags weighted (super-likes 3x).
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
    const maxW = Math.max(1, ...Object.values(tagW));
    const maxAntiW = Math.max(1, ...Object.values(antiW));

    // Re-rank: vector + positive tag overlap − anti-tag penalty + small freshness nudge.
    const now = Date.now();
    const rows = (data as RecEp[]).map(r => {
      const epTags = new Set<string>([
        ...(r.topics || []).map(t => t.toLowerCase()),
        ...(r.category ? [r.category.toLowerCase()] : []),
      ]);
      let overlap = 0;
      let antiOverlap = 0;
      const matched: Array<{ tag: string; w: number }> = [];
      for (const t of epTags) {
        const w = tagW[t];
        if (w) { overlap += w; matched.push({ tag: t, w }); }
        const aw = antiW[t];
        if (aw) antiOverlap += aw;
      }
      const normOverlap = Math.min(1, overlap / (maxW * 2));
      const normAnti = Math.min(1, antiOverlap / (maxAntiW * 2));
      const normSim = Math.max(0, Math.min(1, Number((r as any).final_score) || 0));
      // Small extra freshness bump client-side (RPC already gives some).
      const publishedAt = (r as any).published_at ? new Date((r as any).published_at).getTime() : 0;
      const ageDays = publishedAt ? (now - publishedAt) / 86_400_000 : 9999;
      const freshBonus = ageDays < 7 ? 0.05 : ageDays < 30 ? 0.025 : 0;
      const taste_score = 0.58 * normSim + 0.32 * normOverlap - 0.15 * normAnti + freshBonus;
      const reasons = matched
        .sort((a, b) => b.w - a.w)
        .slice(0, 2)
        .map(m => m.tag);
      return { ...r, taste_score, reasons };
    });

    // Sort by blended taste score, then diversify (≤2 per podcast in final 16).
    rows.sort((a, b) => (b.taste_score! - a.taste_score!));
    const perPod = new Map<string, number>();
    const finalRows: RecEp[] = [];
    for (const r of rows) {
      const n = perPod.get(r.podcast_id) || 0;
      if (n >= 2) continue;
      perPod.set(r.podcast_id, n + 1);
      finalRows.push(r);
      if (finalRows.length >= 16) break;
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
      const c = pickNextCard(pool, seen, tempLiked, tempDisliked, idx);
      if (!c) break;
      out.push(c);
      seen.add(c.id);
      idx++;
    }
    return out;
  }, [pool, current, persisted.seenCardIds, effectiveLiked, disliked, totalSwipes]);

  /* ─────── Actions ─────── */

  const handleStart = () => {
    snapshotUtmFromUrl();
    trackLandingEvent("SwipeStarted");
    setPhase("swipe");
  };

  const handleSwipe = (action: "like" | "skip" | "super") => {
    if (!current || !pool) return;
    const isPositive = action === "like" || action === "super";
    const next: Persisted = {
      ...persisted,
      seenCardIds: [...persisted.seenCardIds, current.id],
      likedCardIds: isPositive ? [...persisted.likedCardIds, current.id] : persisted.likedCardIds,
      dislikedCardIds: action === "skip" ? [...persisted.dislikedCardIds, current.id] : persisted.dislikedCardIds,
      superLikedCardIds: action === "super" ? [...persisted.superLikedCardIds, current.id] : persisted.superLikedCardIds,
      updatedAt: new Date().toISOString(),
    };
    setPersisted(next);
    savePersisted(next);

    // Mild haptic feedback (mobile)
    try { (navigator as any).vibrate?.(action === "super" ? [10, 40, 30] : 15); } catch { /* ignore */ }

    // Build updated arrays for stop check (super counts 2x for vector signal)
    const newLiked = isPositive ? [...liked, current] : liked;
    const newSuper = action === "super" ? [...superLiked, current] : superLiked;
    const newEffective = [...newLiked, ...newSuper];
    const newDisliked = action === "skip" ? [...disliked, current] : disliked;
    const newConf = computeConfidence(newEffective, newDisliked);
    const total = next.seenCardIds.length;
    const positives = next.likedCardIds.length;

    // Drop-off telemetry — fire at fixed milestones so we can see WHERE users quit.
    if ([3, 5, 8, 10, 15, 20].includes(total)) {
      trackLandingEvent("SwipeProgress", { total, positives, action });
    }

    if (shouldStop(total, positives, newConf)) {
      setCurrent(null);
      completedRef.current = true;
      trackLandingEvent("SwipeCompleted", { total, positives });
      trackProfileEvent("swipe_completed", { total, positives });
      setPhase("result");
      return;
    }

    // Pick next card
    const seen = new Set(next.seenCardIds);
    const nextCard = pickNextCard(pool, seen, newEffective, newDisliked, total);
    if (!nextCard) {
      completedRef.current = true;
      trackLandingEvent("SwipeCompleted", { total, positives, reason: "pool_exhausted" });
      setPhase("result");
      setCurrent(null);
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
            totalSwipes={totalSwipes}
            positiveSwipes={positiveSwipes}
            superSwipes={superSwipes}
            confidence={confidence}
            onAction={handleSwipe}
          />
        )}

        {phase === "result" && (
          <ResultView
            liked={liked}
            disliked={disliked}
            superLiked={superLiked}
            recs={recs}
            recsLoading={recsLoading}
            onReset={resetAll}
            onOpen={(p, e) => navigate(`/podcast/${p}/${e}`)}
          />
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
          <div className="font-medium text-foreground">← Balra ❌</div>
          <div className="mt-1">Nem nekem való</div>
        </div>
        <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
          <div className="font-medium text-primary">↑ Fel ⭐</div>
          <div className="mt-1">Imádom</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="font-medium text-foreground">Jobbra ❤ →</div>
          <div className="mt-1">Érdekel</div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────── Swipe ────────────────── */

function SwipeView({
  current, upcoming, loading, totalSwipes, positiveSwipes, superSwipes, confidence, onAction,
}: {
  current: Card | null;
  upcoming: Card[];
  loading: boolean;
  totalSwipes: number;
  positiveSwipes: number;
  superSwipes: number;
  confidence: number;
  onAction: (a: "like" | "skip" | "super") => void;
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

  if (loading) return <Skeleton className="mx-auto aspect-[3/4] h-[min(60svh,30rem)] rounded-3xl" />;
  if (!current) {
    return (
      <div className="rounded-3xl border border-border bg-card p-8 text-center text-muted-foreground">
        Nincs több kártya — most jönnek az ajánlások.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-end text-xs text-muted-foreground">
        <span>magabiztosság: {Math.round(confidence * 100)}%</span>
      </div>
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full bg-gradient-to-r from-primary to-primary/70"
          initial={false}
          animate={{ width: `${Math.min(100, Math.round(confidence * 100))}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 18 }}
        />
      </div>

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
        <ActionBtn label="Nem nekem való" onClick={() => onAction("skip")} variant="skip">
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
        ← skip · ↑ imádom · → like
      </div>
    </div>
  );
}

function SwipeCard({ card, onAction }: { card: Card; onAction: (a: "like" | "skip" | "super") => void }) {
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
            Passz
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
  liked, disliked, superLiked, recs, recsLoading, onReset, onOpen,
}: {
  liked: Card[];
  disliked: Card[];
  superLiked: Card[];
  recs: RecEp[] | null;
  recsLoading: boolean;
  onReset: () => void;
  onOpen: (p: string, e: string) => void;
}) {
  useEffect(() => { trackLandingEvent("ResultViewed"); }, []);
  useEffect(() => { trackLandingEvent("RegistrationOffered"); }, []);
  // TODO(ai-copy): behind a future feature flag, swap deterministic copy below with
  // a `personalize-profile` edge function call that uses Lovable AI Gateway.

  // Match the page-level weighting: super-likes 3x (stronger personalization).
  const effectiveLiked = useMemo(
    () => [...liked, ...superLiked, ...superLiked],
    [liked, superLiked],
  );
  const weights = useMemo(() => tagWeights(effectiveLiked), [effectiveLiked]);
  const archetype = useMemo(() => pickArchetype(weights), [weights]);
  const topInterests = useMemo(() => topTags(weights, 5), [weights]);

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
  const [busy, setBusy] = useState<null | "share" | "download" | "copy" | "ig" | "fb">(null);
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
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID as string;
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/te-podiverzumod-share`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
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
      if (!receiptRef.current) {
        toast.error("A profil még tölt, próbáld újra egy másodperc múlva.");
        return;
      }
      const blob = await renderReceiptPng(receiptRef.current, "story");
      const outcome = await shareReceipt({
        blob,
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
      await navigator.clipboard.writeText(created.url);
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

  /**
   * Story megosztás Instagram / Facebook appba.
   * A web nem tud közvetlenül képet feltölteni a Story compose-ba (csak natív iOS/Android
   * SDK), ezért: (1) mentjük a képet az eszközre, (2) deep-linkkel nyitjuk a Story kamerát,
   * (3) a user kiválasztja a most mentett képet. Két lépés helyett három, de a leggyorsabb
   * elérhető út a webről.
   */
  const handleStoryShare = async (target: "ig" | "fb") => {
    if (busy) return;
    setBusy(target);
    trackLandingEvent("ResultShared", { target: target === "ig" ? "instagram_story" : "facebook_story" });
    trackProfileEvent("profile_share_clicked", {
      archetype_id: listenerProfile.id,
      target: target === "ig" ? "instagram_story" : "facebook_story",
    });
    try {
      const created = await ensureShare();
      if (!receiptRef.current) {
        toast.error("A profil még tölt, próbáld újra egy másodperc múlva.");
        return;
      }
      const blob = await renderReceiptPng(receiptRef.current, "story");
      downloadReceipt(blob, `podiverzum-${listenerProfile.id}.png`);
      trackProfileEvent("profile_image_downloaded", {
        share_id: created?.share_id ?? null,
        archetype_id: listenerProfile.id,
      });

      const appUrl = target === "ig" ? "instagram://story-camera" : "fb://story_composer";
      const webFallback = target === "ig" ? "https://www.instagram.com/" : "https://www.facebook.com/";
      const label = target === "ig" ? "Instagram" : "Facebook";

      const ua = navigator.userAgent || "";
      const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);

      if (isMobile) {
        toast.success(`Kép mentve. Nyitom a ${label} Storyt — válaszd ki a galériából.`, {
          duration: 5000,
        });
        // Kis késleltetés, hogy a toast megjelenjen + a böngésző engedje a navigációt.
        setTimeout(() => {
          // Próbáljuk meg az app deep-linket; ha nincs app, a böngésző marad a fallbacken.
          const start = Date.now();
          window.location.href = appUrl;
          setTimeout(() => {
            // Ha 1.5s múlva még itt vagyunk és nem váltott appra, web fallback.
            if (Date.now() - start < 2000 && document.visibilityState === "visible") {
              window.location.href = webFallback;
            }
          }, 1500);
        }, 600);
      } else {
        toast.success(
          `Kép letöltve. Töltsd fel a ${label}ra Story-ként a telefonodról vagy a ${label} webről.`,
          { duration: 6000 },
        );
      }
      setShowShareHint(true);
    } catch (e) {
      console.error("[story-share] error", e);
      toast.error("Hoppá, valami félrement.");
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
      <div className="rounded-3xl border border-border bg-card p-5 md:p-8">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            A hallgatói profilod
          </div>
          <h2 className="mt-1 text-2xl font-semibold md:text-3xl">
            {listenerProfile.name}
          </h2>
        </div>

        <div className="mt-6 flex justify-center">
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
            A telefon megosztó ablakából 1 koppintással mehet Instagram Storyba, Facebookra, Messengerbe vagy bárhova.
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


      {/* Constellation */}
      {constellation.stars.length >= 3 && (
        <ConstellationVisual constellation={constellation} accent={aura.primary} />
      )}

      {/* Recommended episodes */}
      <div>
        <h3 className="mb-3 text-lg font-semibold">Ajánlott epizódok</h3>
        {recsLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
          </div>
        )}
        {!recsLoading && recs && recs.length > 0 && (
          <div className="space-y-3">
            {recs.map(r => (
              <button
                key={r.episode_id}
                onClick={() => onOpen(r.podcast_slug, r.slug)}
                className="group flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted"
              >
                <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl">
                  {(r.image_url || r.podcast_image_url) ? (
                    <img src={r.image_url || r.podcast_image_url || ""} alt={r.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-muted" />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                    <Play className="h-6 w-6 fill-white text-white" />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs uppercase tracking-wider text-muted-foreground">{r.podcast_title}</div>
                  <div className="line-clamp-2 font-medium">{r.display_title || r.title}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                      <Sparkles className="h-3 w-3" />
                      {mysticMatch(r.taste_score ?? r.similarity, recs!.indexOf(r))}
                    </span>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 flex-shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </button>
            ))}
          </div>
        )}
        {!recsLoading && (!recs || recs.length === 0) && (
          <div className="rounded-2xl border border-border bg-card p-6 text-center text-muted-foreground">
            Még tanuljuk az ízlésedet — swipe-olj párat újra.
          </div>
        )}
      </div>

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
                    <img src={p.image} alt={p.title} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
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
