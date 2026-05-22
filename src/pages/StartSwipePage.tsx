import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, PanInfo } from "framer-motion";
import { Heart, X, Bookmark, Sparkles, RotateCcw, ArrowRight, Play, Search, Plus, Mic, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type SeedEp = {
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
};

type MatchEp = SeedEp & { similarity: number };

type Anchor = {
  kind: "podcast" | "person" | "keyword";
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  subtitle: string | null;
};

const STORAGE_KEY = "podiverzum_vibe_v1";

type VibeState = {
  anchors: Anchor[];
  liked: string[];
  disliked: string[];
  saved: string[];
  updatedAt: string;
};

function loadVibe(): VibeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { anchors: [], liked: [], disliked: [], saved: [], ...parsed };
    }
  } catch {}
  return { anchors: [], liked: [], disliked: [], saved: [], updatedAt: new Date().toISOString() };
}

function saveVibe(v: VibeState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...v, updatedAt: new Date().toISOString() }));
  } catch {}
}

type Phase = "intro" | "swipe" | "results";

export default function StartSwipePage() {
  const [phase, setPhase] = useState<Phase>(() => {
    const v = loadVibe();
    if (v.liked.length >= 3) return "results";
    return "intro";
  });
  const [vibe, setVibe] = useState<VibeState>(() => loadVibe());
  const [cards, setCards] = useState<SeedEp[]>([]);
  const [loading, setLoading] = useState(false);
  const [idx, setIdx] = useState(0);
  const [recs, setRecs] = useState<MatchEp[] | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const navigate = useNavigate();

  const loadSeedsFromAnchors = useCallback(async (anchors: Anchor[]) => {
    setLoading(true);
    const podcastIds = anchors.filter(a => a.kind === "podcast").map(a => a.id);
    const personIds = anchors.filter(a => a.kind === "person").map(a => a.id);
    let data: SeedEp[] | null = null;
    if (podcastIds.length || personIds.length) {
      const res = await supabase.rpc("get_swipe_seed_from_anchors", {
        p_podcast_ids: podcastIds,
        p_person_ids: personIds,
        p_limit: 8,
      });
      if (!res.error && res.data) data = res.data as SeedEp[];
    }
    // Fallback / top-up with random HU seeds if not enough
    if (!data || data.length < 4) {
      const res2 = await supabase.rpc("get_swipe_seed_episodes", { p_limit: 8 });
      if (!res2.error && res2.data) {
        const existing = new Set((data || []).map(e => e.episode_id));
        const extras = (res2.data as SeedEp[]).filter(e => !existing.has(e.episode_id));
        data = [...(data || []), ...extras].slice(0, 8);
      }
    }
    setCards(data || []);
    setIdx(0);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (phase === "results" && vibe.liked.length >= 1 && !recs) {
      void fetchRecs(vibe);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const fetchRecs = async (v: VibeState) => {
    if (v.liked.length === 0) return;
    setRecsLoading(true);
    const { data, error } = await supabase.rpc("match_episodes_by_centroid", {
      p_liked: v.liked,
      p_disliked: v.disliked,
      p_limit: 8,
    });
    if (!error && data) setRecs(data as MatchEp[]);
    setRecsLoading(false);
  };

  const startSwipe = async (anchors: Anchor[]) => {
    const v = { ...vibe, anchors };
    setVibe(v);
    saveVibe(v);
    setPhase("swipe");
    await loadSeedsFromAnchors(anchors);
  };

  const current = cards[idx];
  const next = cards[idx + 1];

  const handleSwipe = (action: "like" | "skip" | "save") => {
    if (!current) return;
    const v = { ...vibe };
    if (action === "like") v.liked = [...v.liked, current.episode_id];
    if (action === "skip") v.disliked = [...v.disliked, current.episode_id];
    if (action === "save") v.saved = [...v.saved, current.episode_id];
    setVibe(v);
    saveVibe(v);
    const newIdx = idx + 1;
    setIdx(newIdx);
    if (newIdx >= cards.length) {
      setPhase("results");
      void fetchRecs(v);
    }
  };

  const resetAll = () => {
    const empty: VibeState = { anchors: [], liked: [], disliked: [], saved: [], updatedAt: new Date().toISOString() };
    saveVibe(empty);
    setVibe(empty);
    setRecs(null);
    setIdx(0);
    setCards([]);
    setPhase("intro");
  };

  const moreCards = async () => {
    setRecs(null);
    setPhase("swipe");
    await loadSeedsFromAnchors(vibe.anchors);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-xl px-4 pt-6 pb-32 md:pt-10">
        <header className="mb-6 flex items-center justify-between">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Vissza</Link>
          {(vibe.liked.length > 0 || vibe.anchors.length > 0) && (
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
          {phase === "intro" && (
            <>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Mondj egy-két nevet, amit szeretsz.
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Egy podcast, egy műsorvezető, egy közszereplő — bárki, akit szívesen hallgatsz. Innen építjük fel a Te Podiverzumodat.
              </p>
            </>
          )}
          {phase === "swipe" && (
            <>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
                Húzd jobbra, amit hallgatnál.
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Jobbra ❤ · Balra ❌ · Felfelé 🔖
              </p>
            </>
          )}
        </div>

        {phase === "intro" && (
          <IntroPicker
            initial={vibe.anchors}
            onContinue={startSwipe}
          />
        )}

        {phase === "swipe" && (
          <SwipeDeck
            current={current}
            next={next}
            loading={loading}
            onAction={handleSwipe}
            progress={{ done: idx, total: cards.length }}
          />
        )}

        {phase === "results" && (
          <ResultsView
            recs={recs}
            loading={recsLoading}
            likedCount={vibe.liked.length}
            savedIds={vibe.saved}
            anchors={vibe.anchors}
            onMore={moreCards}
            onReset={resetAll}
            onOpen={(p, e) => navigate(`/podcast/${p}/${e}`)}
          />
        )}
      </div>
    </div>
  );
}

/* ──────────────── Intro: anchor picker ──────────────── */

function IntroPicker({
  initial, onContinue,
}: {
  initial: Anchor[];
  onContinue: (anchors: Anchor[]) => void;
}) {
  const [picked, setPicked] = useState<Anchor[]>(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Anchor[]>([]);
  const [searching, setSearching] = useState(false);
  const tRef = useRef<number | null>(null);

  useEffect(() => {
    if (tRef.current) window.clearTimeout(tRef.current);
    if (query.trim().length < 2) { setResults([]); return; }
    tRef.current = window.setTimeout(async () => {
      setSearching(true);
      const { data, error } = await supabase.rpc("search_swipe_anchors", { p_query: query.trim(), p_limit: 8 });
      if (!error && data) setResults(data as Anchor[]);
      setSearching(false);
    }, 200);
    return () => { if (tRef.current) window.clearTimeout(tRef.current); };
  }, [query]);

  const add = (a: Anchor) => {
    if (picked.some(p => p.kind === a.kind && p.id === a.id)) return;
    setPicked([...picked, a]);
    setQuery("");
    setResults([]);
  };
  const remove = (a: Anchor) => setPicked(picked.filter(p => !(p.kind === a.kind && p.id === a.id)));

  const canContinue = picked.length >= 1;

  return (
    <div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Pl. Partizán, Friderikusz, Magyar Péter…"
          autoFocus
          className="w-full rounded-2xl border border-border bg-card py-3 pl-10 pr-4 text-base outline-none focus:border-primary"
        />
      </div>

      {results.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
          {results.map(r => (
            <button
              key={`${r.kind}-${r.id}`}
              onClick={() => add(r)}
              className="flex w-full items-center gap-3 border-b border-border/50 px-3 py-2 text-left last:border-0 hover:bg-muted"
            >
              <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                {r.image_url ? (
                  <img src={r.image_url} alt={r.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    {r.kind === "podcast" ? <Mic className="h-4 w-4" /> : <User className="h-4 w-4" />}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {r.kind === "podcast" ? "Podcast" : "Személy"} {r.subtitle ? `· ${r.subtitle}` : ""}
                </div>
              </div>
              <Plus className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      {searching && query.length >= 2 && results.length === 0 && (
        <div className="mt-2 text-xs text-muted-foreground px-1">Keresés…</div>
      )}
      {!searching && query.length >= 2 && results.length === 0 && (
        <div className="mt-2 text-xs text-muted-foreground px-1">Nincs találat — próbálj más nevet.</div>
      )}

      {picked.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">A te magjaid</div>
          <div className="flex flex-wrap gap-2">
            {picked.map(a => (
              <button
                key={`${a.kind}-${a.id}`}
                onClick={() => remove(a)}
                className="group inline-flex items-center gap-2 rounded-full border border-border bg-card pl-1 pr-3 py-1 text-sm hover:border-destructive/50"
              >
                <div className="h-6 w-6 overflow-hidden rounded-full bg-muted">
                  {a.image_url ? (
                    <img src={a.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      {a.kind === "podcast" ? <Mic className="h-3 w-3" /> : <User className="h-3 w-3" />}
                    </div>
                  )}
                </div>
                <span className="max-w-[160px] truncate">{a.name}</span>
                <X className="h-3 w-3 text-muted-foreground group-hover:text-destructive" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        <Button
          onClick={() => onContinue(picked)}
          disabled={!canContinue}
          size="lg"
          className="w-full"
        >
          {canContinue ? (
            <>Mehet a swipe <ArrowRight className="ml-2 h-4 w-4" /></>
          ) : (
            <>Adj hozzá legalább egyet</>
          )}
        </Button>
        <button
          onClick={() => onContinue([])}
          className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Kihagyom — találj ki valamit nekem
        </button>
      </div>
    </div>
  );
}

/* ──────────────── Swipe deck ──────────────── */

function SwipeDeck({
  current, next, loading, onAction, progress,
}: {
  current?: SeedEp;
  next?: SeedEp;
  loading: boolean;
  onAction: (a: "like" | "skip" | "save") => void;
  progress: { done: number; total: number };
}) {
  if (loading) {
    return <Skeleton className="aspect-[3/4] w-full rounded-3xl" />;
  }
  if (!current) {
    return (
      <div className="rounded-3xl border border-border bg-card p-8 text-center text-muted-foreground">
        Nincs több kártya — most már jönnek az ajánlások.
      </div>
    );
  }

  return (
    <div>
      <div className="relative aspect-[3/4] w-full">
        {next && <Card key={next.episode_id} ep={next} stacked />}
        <AnimatePresence mode="popLayout">
          <SwipeCard key={current.episode_id} ep={current} onAction={onAction} />
        </AnimatePresence>
      </div>

      <div className="mt-6 flex items-center justify-center gap-4">
        <ActionBtn label="Kihagy" onClick={() => onAction("skip")} variant="skip">
          <X className="h-6 w-6" />
        </ActionBtn>
        <ActionBtn label="Később" onClick={() => onAction("save")} variant="save">
          <Bookmark className="h-5 w-5" />
        </ActionBtn>
        <ActionBtn label="Hallgatnám" onClick={() => onAction("like")} variant="like">
          <Heart className="h-6 w-6 fill-current" />
        </ActionBtn>
      </div>

      <div className="mt-4 flex items-center justify-center gap-1">
        {Array.from({ length: progress.total }).map((_, i) => (
          <div
            key={i}
            className={`h-1 w-6 rounded-full transition-colors ${
              i < progress.done ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function ActionBtn({
  children, label, onClick, variant,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  variant: "like" | "skip" | "save";
}) {
  const styles =
    variant === "like"
      ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/30"
      : variant === "skip"
      ? "bg-card border border-border hover:bg-muted"
      : "bg-card border border-border hover:bg-muted";
  const size = variant === "save" ? "h-12 w-12" : "h-16 w-16";
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`${size} ${styles} rounded-full flex items-center justify-center transition-transform active:scale-95`}
    >
      {children}
    </button>
  );
}

function SwipeCard({
  ep, onAction,
}: {
  ep: SeedEp;
  onAction: (a: "like" | "skip" | "save") => void;
}) {
  const handleDragEnd = (_: any, info: PanInfo) => {
    const { offset, velocity } = info;
    if (offset.x > 120 || velocity.x > 600) return onAction("like");
    if (offset.x < -120 || velocity.x < -600) return onAction("skip");
    if (offset.y < -120 || velocity.y < -600) return onAction("save");
  };

  return (
    <motion.div
      className="absolute inset-0"
      drag
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
      whileTap={{ scale: 0.98, cursor: "grabbing" }}
      initial={{ scale: 0.95, opacity: 0, y: 20 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ x: 0, opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      style={{ cursor: "grab" }}
    >
      <Card ep={ep} />
    </motion.div>
  );
}

function Card({ ep, stacked = false }: { ep: SeedEp; stacked?: boolean }) {
  const img = ep.image_url || ep.podcast_image_url || undefined;
  return (
    <div
      className={`absolute inset-0 overflow-hidden rounded-3xl border border-border bg-card shadow-xl ${
        stacked ? "scale-[0.96] opacity-60" : ""
      }`}
    >
      {img ? (
        <img src={img} alt={ep.title} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/30 to-muted" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
        <div className="mb-2 text-xs uppercase tracking-wider opacity-80">{ep.podcast_title}</div>
        <h2 className="text-2xl font-semibold leading-tight">
          {ep.display_title || ep.title}
        </h2>
        {ep.ai_summary && (
          <p className="mt-3 line-clamp-3 text-sm opacity-90">{ep.ai_summary}</p>
        )}
      </div>
    </div>
  );
}

/* ──────────────── Results ──────────────── */

function ResultsView({
  recs, loading, likedCount, savedIds, anchors, onMore, onReset, onOpen,
}: {
  recs: MatchEp[] | null;
  loading: boolean;
  likedCount: number;
  savedIds: string[];
  anchors: Anchor[];
  onMore: () => void;
  onReset: () => void;
  onOpen: (podcastSlug: string, episodeSlug: string) => void;
}) {
  if (likedCount === 0) {
    return (
      <div className="rounded-3xl border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">Egyetlen lájk sem érkezett — próbáljuk újra?</p>
        <Button onClick={onReset} className="mt-4">Új kártyák</Button>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-6 rounded-2xl border border-border bg-card p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">A te vibed</div>
        <div className="mt-1 text-lg font-medium">
          {likedCount} lájk · {savedIds.length} mentett későbbre
        </div>
        {anchors.length > 0 && (
          <div className="mt-2 text-xs text-muted-foreground">
            Magok: {anchors.map(a => a.name).join(" · ")}
          </div>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          Ezt a listát böngésződ helyben őrzi — bármikor visszajössz, ott folytatod, ahol abbahagytad.
        </p>
      </div>

      <h2 className="mb-3 text-xl font-semibold">Ez illik a vibedhez</h2>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
        </div>
      )}

      {!loading && recs && recs.length > 0 && (
        <div className="space-y-3">
          {recs.map((r) => (
            <button
              key={r.episode_id}
              onClick={() => onOpen(r.podcast_slug, r.slug)}
              className="group flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted"
            >
              <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl">
                {r.image_url ? (
                  <img src={r.image_url} alt={r.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-muted" />
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                  <Play className="h-6 w-6 fill-white text-white" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs uppercase tracking-wider text-muted-foreground">
                  {r.podcast_title}
                </div>
                <div className="line-clamp-2 font-medium">{r.display_title || r.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {Math.round(r.similarity * 100)}% egyezés a vibeddel
                </div>
              </div>
              <ArrowRight className="h-5 w-5 flex-shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </button>
          ))}
        </div>
      )}

      {!loading && (!recs || recs.length === 0) && (
        <div className="rounded-2xl border border-border bg-card p-6 text-center text-muted-foreground">
          Nem találtam elég hasonlót — swipe-olj még párat, és pontosabb lesz.
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button onClick={onMore} variant="secondary" className="flex-1">
          Még kártyák
        </Button>
        <Button onClick={onReset} variant="ghost" className="flex-1">
          Új vibe nulláról
        </Button>
      </div>
    </div>
  );
}
