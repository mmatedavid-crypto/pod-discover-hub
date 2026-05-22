import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, PanInfo } from "framer-motion";
import { Heart, X, Sparkles, RotateCcw, ArrowRight, Share2, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Vec, zero, mean, cosine, coherence, normalize, toPgVector, parsePgVector,
} from "@/lib/tasteVector";
import { ARCHETYPES, pickArchetype, archetypeConfidence } from "@/lib/tasteArchetypes";
import { renderShareCard, shareOrDownload } from "@/lib/tasteShareCard";

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
        updatedAt: p.updatedAt || new Date().toISOString(),
      };
    }
  } catch { /* ignore */ }
  return {
    sessionId: crypto.randomUUID(),
    seenCardIds: [],
    likedCardIds: [],
    dislikedCardIds: [],
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

function pickNextCard(
  pool: Card[],
  seen: Set<string>,
  liked: Card[],
  disliked: Card[],
  swipeIdx: number,
): Card | null {
  const candidates = pool.filter(c => !seen.has(c.id));
  if (candidates.length === 0) return null;

  // First 8 swipes: ensure broad coverage, rotate domains
  if (swipeIdx < 8) {
    const wantedDomain = BROAD_DOMAINS[swipeIdx % BROAD_DOMAINS.length];
    const broadMatches = candidates.filter(
      c => c.stage === "broad" && (c.topic_tags.includes(wantedDomain) || c.archetype_tags.includes(wantedDomain))
    );
    if (broadMatches.length > 0) {
      return broadMatches[Math.floor(Math.random() * Math.min(3, broadMatches.length))];
    }
    const anyBroad = candidates.filter(c => c.stage === "broad");
    if (anyBroad.length > 0) return anyBroad[Math.floor(Math.random() * anyBroad.length)];
  }

  // Adaptive scoring
  const posMean = liked.length ? mean(liked.map(c => c.card_embedding)) : null;
  const negMean = disliked.length ? mean(disliked.map(c => c.card_embedding)) : null;
  const likedTags = tagWeights(liked);

  const scored = candidates.map(c => {
    const relevance = posMean ? Math.max(0, cosine(c.card_embedding, posMean)) : 0;
    // uncertainty: prefer cards near decision boundary (mid relevance), prefer fresh archetypes
    const uncertainty = posMean ? 1 - Math.abs(relevance - 0.5) * 2 : 0.5;
    // coverage_gap: low-weight topics
    const cardTagWeight = [...c.topic_tags, ...c.archetype_tags]
      .reduce((s, t) => s + (likedTags[t] || 0), 0);
    const coverageGap = 1 / (1 + cardTagWeight);
    // archetype_disambiguation: penalize cards already deeply covered by negatives too
    const negSim = negMean ? Math.max(0, cosine(c.card_embedding, negMean)) : 0;
    const disamb = 1 - negSim;
    const rand = Math.random();
    const score = 0.35 * uncertainty + 0.25 * relevance + 0.20 * coverageGap + 0.10 * disamb + 0.10 * rand;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  // Pick from top 3 to keep some variety
  const top = scored.slice(0, 3);
  return top[Math.floor(Math.random() * top.length)].c;
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

  const totalSwipes = persisted.seenCardIds.length;
  const positiveSwipes = persisted.likedCardIds.length;
  const confidence = useMemo(() => computeConfidence(liked, disliked), [liked, disliked]);

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
    const next = pickNextCard(pool, seen, liked, disliked, totalSwipes);
    setCurrent(next);
  }, [phase, pool, current, persisted.seenCardIds, liked, disliked, totalSwipes]);

  // Auto-fetch recs when entering result
  useEffect(() => {
    if (phase !== "result" || recs || liked.length === 0) return;
    void fetchRecs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const fetchRecs = async () => {
    if (liked.length === 0) return;
    setRecsLoading(true);
    const userVec = normalize(mean(liked.map(c => c.card_embedding)));
    const negVec = disliked.length ? normalize(mean(disliked.map(c => c.card_embedding))) : null;
    const { data, error } = await supabase.rpc("match_episodes_by_taste_vector", {
      p_user_vector: toPgVector(userVec) as any,
      p_negative_vector: negVec ? (toPgVector(negVec) as any) : null,
      p_exclude_episode_ids: [],
      p_limit: 16,
    });
    if (!error && data) setRecs(data as RecEp[]);
    setRecsLoading(false);
  };

  /* ─────── Actions ─────── */

  const handleStart = () => {
    setPhase("swipe");
  };

  const handleSwipe = (action: "like" | "skip") => {
    if (!current || !pool) return;
    const next: Persisted = {
      ...persisted,
      seenCardIds: [...persisted.seenCardIds, current.id],
      likedCardIds: action === "like" ? [...persisted.likedCardIds, current.id] : persisted.likedCardIds,
      dislikedCardIds: action === "skip" ? [...persisted.dislikedCardIds, current.id] : persisted.dislikedCardIds,
      updatedAt: new Date().toISOString(),
    };
    setPersisted(next);
    savePersisted(next);

    // Build updated liked/disliked arrays for stop check
    const newLiked = action === "like" ? [...liked, current] : liked;
    const newDisliked = action === "skip" ? [...disliked, current] : disliked;
    const newConf = computeConfidence(newLiked, newDisliked);
    const total = next.seenCardIds.length;
    const positives = next.likedCardIds.length;

    if (shouldStop(total, positives, newConf)) {
      setCurrent(null);
      setPhase("result");
      return;
    }

    // Pick next card
    const seen = new Set(next.seenCardIds);
    const nextCard = pickNextCard(pool, seen, newLiked, newDisliked, total);
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
            loading={!pool}
            totalSwipes={totalSwipes}
            positiveSwipes={positiveSwipes}
            confidence={confidence}
            onAction={handleSwipe}
          />
        )}

        {phase === "result" && (
          <ResultView
            liked={liked}
            disliked={disliked}
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
        {poolReady && (
          <p className="text-xs text-muted-foreground text-center">{poolSize} kártya áll készen</p>
        )}
      </div>

      <div className="mt-10 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="font-medium text-foreground">Jobbra ❤</div>
          <div className="mt-1">Érdekel</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="font-medium text-foreground">Balra ❌</div>
          <div className="mt-1">Nem nekem való</div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────── Swipe ────────────────── */

function SwipeView({
  current, loading, totalSwipes, positiveSwipes, confidence, onAction,
}: {
  current: Card | null;
  loading: boolean;
  totalSwipes: number;
  positiveSwipes: number;
  confidence: number;
  onAction: (a: "like" | "skip") => void;
}) {
  if (loading) return <Skeleton className="aspect-[3/4] w-full rounded-3xl" />;
  if (!current) {
    return (
      <div className="rounded-3xl border border-border bg-card p-8 text-center text-muted-foreground">
        Nincs több kártya — most jönnek az ajánlások.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{totalSwipes} swipe · {positiveSwipes} ❤</span>
        <span>magabiztosság: {Math.round(confidence * 100)}%</span>
      </div>
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${Math.min(100, Math.round(confidence * 100))}%` }}
        />
      </div>

      <div className="relative aspect-[3/4] w-full">
        <AnimatePresence mode="popLayout">
          <SwipeCard key={current.id} card={current} onAction={onAction} />
        </AnimatePresence>
      </div>

      <div className="mt-6 flex items-center justify-center gap-6">
        <ActionBtn label="Nem nekem való" onClick={() => onAction("skip")} variant="skip">
          <X className="h-7 w-7" />
        </ActionBtn>
        <ActionBtn label="Érdekel" onClick={() => onAction("like")} variant="like">
          <Heart className="h-7 w-7 fill-current" />
        </ActionBtn>
      </div>
    </div>
  );
}

function SwipeCard({ card, onAction }: { card: Card; onAction: (a: "like" | "skip") => void }) {
  const handleDragEnd = (_: any, info: PanInfo) => {
    const { offset, velocity } = info;
    if (offset.x > 120 || velocity.x > 600) return onAction("like");
    if (offset.x < -120 || velocity.x < -600) return onAction("skip");
  };

  return (
    <motion.div
      className="absolute inset-0"
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
      whileTap={{ scale: 0.98, cursor: "grabbing" }}
      initial={{ scale: 0.95, opacity: 0, y: 20 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ x: 0, opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      style={{ cursor: "grab" }}
    >
      <div className="absolute inset-0 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/30 via-card to-card shadow-xl">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.15),transparent_60%)]" />
        <div className="relative flex h-full flex-col justify-end p-8">
          <div className="mb-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {card.stage === "broad" ? "felfedezés" : card.stage === "refine" ? "finomítás" : card.stage === "style" ? "stílus" : "ellenőrzés"}
          </div>
          <h2 className="text-2xl font-semibold leading-snug text-foreground md:text-3xl">
            {card.title}
          </h2>
          {card.subtitle && (
            <p className="mt-3 text-sm text-muted-foreground">{card.subtitle}</p>
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
  variant: "like" | "skip";
}) {
  const styles =
    variant === "like"
      ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/30"
      : "bg-card border border-border hover:bg-muted text-foreground";
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`h-16 w-16 ${styles} rounded-full flex items-center justify-center transition-transform active:scale-95`}
    >
      {children}
    </button>
  );
}

/* ────────────────── Result ────────────────── */

function ResultView({
  liked, disliked, recs, recsLoading, onReset, onOpen,
}: {
  liked: Card[];
  disliked: Card[];
  recs: RecEp[] | null;
  recsLoading: boolean;
  onReset: () => void;
  onOpen: (p: string, e: string) => void;
}) {
  // TODO(ai-copy): behind a future feature flag, swap deterministic copy below with
  // a `personalize-profile` edge function call that uses Lovable AI Gateway.

  const weights = useMemo(() => tagWeights(liked), [liked]);
  const archetype = useMemo(() => pickArchetype(weights), [weights]);
  const topInterests = useMemo(() => topTags(weights, 5), [weights]);

  // Build "Podcast-DNS" — top topic_tags from liked, normalized
  const dna = useMemo(() => {
    const topicW: Record<string, number> = {};
    for (const c of liked) for (const t of c.topic_tags) topicW[t] = (topicW[t] || 0) + 1;
    const entries = Object.entries(topicW).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
    return entries.map(([label, v]) => ({ label, pct: v / total }));
  }, [liked]);

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
        dna,
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
      {/* Hero profile */}
      <div className="rounded-3xl border border-border bg-card p-6 md:p-8">
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          A Te Podiverzumod elkészült
        </div>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{archetype.name}</h2>
        <p className="mt-3 text-sm text-muted-foreground md:text-base">{archetype.tagline}</p>

        {topInterests.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {topInterests.map(t => (
              <span key={t} className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Podcast-DNS */}
        {dna.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Podcast-DNS</div>
            <div className="space-y-2">
              {dna.map(row => (
                <div key={row.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-foreground">{row.label}</span>
                    <span className="text-muted-foreground">{Math.round(row.pct * 100)}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${Math.round(row.pct * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button onClick={handleShare} className="flex-1">
            <Share2 className="mr-2 h-4 w-4" /> Megosztom
          </Button>
          <Button onClick={onReset} variant="ghost" className="flex-1">
            Újrakezdem
          </Button>
        </div>
      </div>

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
        {liked.length} ❤ · {disliked.length} ❌ — a profilod helyben tárolódik
      </div>
    </div>
  );
}
