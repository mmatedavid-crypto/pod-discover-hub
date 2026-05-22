import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, PanInfo, useMotionValue, useTransform } from "framer-motion";
import { Heart, X, Sparkles, RotateCcw, ArrowRight, Share2, Play, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Vec, zero, mean, sub, scale, add, cosine, coherence, normalize, toPgVector, parsePgVector,
} from "@/lib/tasteVector";
import { ARCHETYPES, pickArchetype, archetypeConfidence } from "@/lib/tasteArchetypes";
import { renderShareCard, shareOrDownload } from "@/lib/tasteShareCard";
import { buildAura, buildConstellation, buildVerdict, buildPdvCode } from "@/lib/podiverzumProfile";

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
  const [phase, setPhase] = useState<Phase>("intro");
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

  // Vector weighting: super-likes count 2x (we duplicate them in the positive set).
  const effectiveLiked = useMemo(() => [...liked, ...superLiked], [liked, superLiked]);

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

    // FIX: All taste-card prompts start with "Magyar [nyelvű] podcast…", so their
    // embeddings share a strong common direction. A naive mean(liked) collapses to
    // the catalog centroid → same recs regardless of choices. We mean-center against
    // the pool centroid so the user's *deviation* dominates, then re-anchor.
    const centroid = mean(pool.map(c => c.card_embedding));
    const likedDev = mean(effectiveLiked.map(c => sub(c.card_embedding, centroid)));
    const dislikedDev = disliked.length
      ? mean(disliked.map(c => sub(c.card_embedding, centroid)))
      : zero(centroid.length);
    // direction = positives push, negatives pull
    const direction = sub(likedDev, dislikedDev);
    // re-anchor to the HU-podcast manifold, amplified along the user's axis
    const userVec = normalize(add(centroid, scale(direction, 2.5)));
    const negVec = disliked.length
      ? normalize(add(centroid, scale(dislikedDev, 2.5)))
      : null;

    const { data, error } = await supabase.rpc("match_episodes_by_taste_vector", {
      p_user_vector: toPgVector(userVec) as any,
      p_negative_vector: negVec ? (toPgVector(negVec) as any) : null,
      p_exclude_episode_ids: [],
      p_limit: 16,
    });
    if (!error && data) setRecs(data as RecEp[]);
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

    if (shouldStop(total, positives, newConf)) {
      setCurrent(null);
      setPhase("result");
      return;
    }

    // Pick next card
    const seen = new Set(next.seenCardIds);
    const nextCard = pickNextCard(pool, seen, newEffective, newDisliked, total);
    if (!nextCard) {
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
    setPhase("intro");
  };

  /* ─────── Render ─────── */

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-xl px-4 pt-6 pb-32 md:pt-10">
        <header className="mb-6 flex items-center justify-between">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Vissza</Link>
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
  // TODO(ai-copy): behind a future feature flag, swap deterministic copy below with
  // a `personalize-profile` edge function call that uses Lovable AI Gateway.

  // Weight super-likes 2x for taste signal: duplicate them in the positive set.
  const effectiveLiked = useMemo(() => [...liked, ...superLiked], [liked, superLiked]);
  const weights = useMemo(() => tagWeights(effectiveLiked), [effectiveLiked]);
  const archetype = useMemo(() => pickArchetype(weights), [weights]);
  const topInterests = useMemo(() => topTags(weights, 5), [weights]);

  // ── Aura: mood-tag-weighted color palette
  const moodWeights = useMemo(() => {
    const w: Record<string, number> = {};
    for (const c of liked) for (const t of c.mood_tags) w[t] = (w[t] || 0) + 1;
    for (const c of superLiked) for (const t of c.mood_tags) w[t] = (w[t] || 0) + 2;
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
      w[t].weight += 2;
      w[t].superCount += 1;
    }
    return Object.entries(w)
      .map(([label, v]) => ({ label, weight: v.weight, superCount: v.superCount }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 7);
  }, [liked, superLiked]);
  const constellation = useMemo(() => buildConstellation(topicStars, seedKey), [topicStars, seedKey]);
  const verdict = useMemo(() => buildVerdict(seedKey), [seedKey]);
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

  const sharing = useRef(false);
  const handleShare = async () => {
    if (sharing.current) return;
    sharing.current = true;
    try {
      const blob = await renderShareCard({
        archetype,
        interests: topInterests,
        dna: topicStars.map((s, i) => ({
          label: s.label,
          intensity: i === 0 ? "Domináns" : i < 2 ? "Erős" : i < 4 ? "Markáns" : "Színező",
          strength: 1 - i * 0.14,
        })),
      });
      await shareOrDownload(blob);
    } finally {
      sharing.current = false;
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
      {/* Hero: Aura visual */}
      <div className="relative overflow-hidden rounded-3xl border border-border bg-card">
        {/* Animated aura background */}
        <div className="relative h-72 w-full overflow-hidden md:h-96">
          <AuraVisual colors={aura.colors} />
          {/* Vignette + content overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-6 md:p-8">
            <div className="text-[10px] uppercase tracking-[0.25em] text-white/70 md:text-xs">
              A te aurád · {aura.essence}
            </div>
            <h2 className="mt-1 text-3xl font-semibold tracking-tight text-white drop-shadow-md md:text-5xl">
              {archetype.name}
            </h2>
          </div>
        </div>

        {/* Verdict + interests + code */}
        <div className="space-y-5 p-6 md:p-8">
          <p className="text-sm leading-relaxed text-foreground md:text-base">
            {verdict}
          </p>

          {topInterests.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {topInterests.map(t => (
                <span key={t} className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-4">
            <div className="font-mono text-xs tracking-wider text-muted-foreground">
              {pdvCode}
            </div>
            <div className="flex gap-2">
              <Button onClick={handleShare} size="sm">
                <Share2 className="mr-2 h-4 w-4" /> Megosztom
              </Button>
              <Button onClick={onReset} variant="ghost" size="sm">
                <RotateCcw className="mr-2 h-4 w-4" /> Újra
              </Button>
            </div>
          </div>
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
                  <div className="mt-1 text-xs text-muted-foreground">
                    {Math.round(r.similarity * 100)}% egyezés
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

      <div className="text-center text-xs text-muted-foreground">
        {liked.length} ❤ {superLiked.length > 0 && <>· <span className="text-primary">{superLiked.length} ⭐</span> </>}· {disliked.length} ❌ — a profilod helyben tárolódik
      </div>
    </div>
  );
}
