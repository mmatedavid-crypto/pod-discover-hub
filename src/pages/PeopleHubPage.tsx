import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import PersonCard, { PersonCardData } from "@/components/PersonCard";

interface PersonRow extends PersonCardData {
  id: string;
  people_hub_score: number;
  distinct_podcast_count: number;
  strong_mention_count: number;
  recent_relevant_episode_count_30d: number;
}

const MIN_SECTION = 4;

const BASE_COLS = "id, slug, name, disambiguation_label, short_bio, ai_bio, episode_count, podcast_count, distinct_podcast_count, strong_mention_count, recent_relevant_episode_count_30d, latest_accepted_relevant_episode_at, people_hub_score";

const baseFilter = () =>
  supabase
    .from("people")
    .select(BASE_COLS)
    .eq("is_public", true)
    .eq("is_browsable_in_people_hub", true)
    .in("activation_status", ["indexable", "public_noindex", "manual_approved"])
    .neq("ai_review_status", "needs_human_review")
    .neq("ai_review_status", "duplicate_candidate");

function dedupeFill(primary: PersonRow[], fill: PersonRow[], target: number, excludeIds: Set<string>): PersonRow[] {
  const ids = new Set(primary.map(p => p.id));
  const out = [...primary];
  for (const p of fill) {
    if (out.length >= target) break;
    if (ids.has(p.id) || excludeIds.has(p.id)) continue;
    out.push(p);
    ids.add(p.id);
  }
  return out;
}

export default function PeopleHubPage() {
  const [recent, setRecent] = useState<PersonRow[]>([]);
  const [crossPodcast, setCrossPodcast] = useState<PersonRow[]>([]);
  const [featured, setFeatured] = useState<PersonRow[]>([]);
  const [searchPool, setSearchPool] = useState<PersonRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Pull a larger eligible pool once for in-memory section building + fill
      const { data: poolData } = await baseFilter()
        .order("people_hub_score", { ascending: false })
        .limit(400);
      const pool = ((poolData || []) as any) as PersonRow[];

      const now = Date.now();
      const days = (n: number) => now - n * 24 * 3600 * 1000;
      const tsOf = (p: PersonRow) => p.latest_accepted_relevant_episode_at ? new Date(p.latest_accepted_relevant_episode_at).getTime() : 0;

      // Section 1: Mostanában említve — primary: ≤30d
      const recent30 = pool
        .filter(p => p.recent_relevant_episode_count_30d > 0)
        .sort((a, b) => tsOf(b) - tsOf(a))
        .slice(0, 12);
      // Fallback fill: ≤60d, then by latest accepted episode overall
      const recentFill = pool
        .filter(p => tsOf(p) >= days(60))
        .sort((a, b) => tsOf(b) - tsOf(a));
      const recentFillAny = pool
        .filter(p => tsOf(p) > 0)
        .sort((a, b) => tsOf(b) - tsOf(a));
      let recentFinal = dedupeFill(recent30, recentFill, 12, new Set());
      recentFinal = dedupeFill(recentFinal, recentFillAny, Math.max(MIN_SECTION, 8), new Set());

      // Section 2: Több műsorban szerepel — primary
      const crossPrimary = pool
        .filter(p => p.distinct_podcast_count >= 2 && p.strong_mention_count >= 2)
        .sort((a, b) => (b.people_hub_score || 0) - (a.people_hub_score || 0))
        .slice(0, 18);
      // Fallback fill: distinct_podcast_count >= 2 and high hub score
      const crossFill = pool
        .filter(p => p.distinct_podcast_count >= 2)
        .sort((a, b) => (b.people_hub_score || 0) - (a.people_hub_score || 0));
      const crossFinal = dedupeFill(crossPrimary, crossFill, 18, new Set());

      // Section 3: Érdemes felfedezni — general discovery, exclude what we already showed
      const used = new Set<string>([...recentFinal.map(p => p.id), ...crossFinal.map(p => p.id)]);
      const featuredPool = pool
        .filter(p => !used.has(p.id))
        .sort((a, b) => (b.people_hub_score || 0) - (a.people_hub_score || 0))
        .slice(0, 24);

      // Enforce minimum section count: hide sections with < MIN_SECTION
      setRecent(recentFinal.length >= MIN_SECTION ? recentFinal : []);
      setCrossPodcast(crossFinal.length >= MIN_SECTION ? crossFinal : []);
      setFeatured(featuredPool.length >= MIN_SECTION ? featuredPool : []);
      setSearchPool(pool);
      setLoading(false);

      setSeo({
        title: "Személyek magyar podcastokban — Podiverzum",
        description: "Politikusok, üzleti vezetők, alkotók és gondolkodók, akik magyar podcastokban szerepelnek vagy szóba kerülnek.",
        jsonLd: [{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Személyek magyar podcastokban",
          url: typeof window !== "undefined" ? window.location.href.split("?")[0] : undefined,
        }],
      });
    })();
  }, []);

  const filtered = q.trim().length >= 2
    ? searchPool.filter(p => p.name.toLowerCase().includes(q.toLowerCase().trim()))
    : null;

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 sm:py-14 max-w-5xl px-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Személyek</div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mt-2">Személyek magyar podcastokban</h1>
          <p className="text-foreground/80 mt-4 max-w-2xl">
            Fedezz fel személyeket, akik magyar podcastokban szerepelnek vagy szóba kerülnek. Politikusok, üzleti vezetők, alkotók, kutatók.
          </p>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Keress személyt…"
            className="mt-6 w-full max-w-md px-3 py-2 rounded-md bg-card border border-border focus:border-primary/60 outline-none text-sm"
          />
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl px-4 space-y-12">
        {loading && <div className="text-muted-foreground">Betöltés…</div>}

        {filtered ? (
          <section>
            <h2 className="text-xl font-semibold mb-4">Találatok</h2>
            {filtered.length === 0 ? (
              <div className="text-muted-foreground text-sm">Nincs találat.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered.slice(0, 60).map(p => <PersonCard key={p.id} p={p} />)}
              </div>
            )}
          </section>
        ) : (
          <>
            {recent.length > 0 && (
              <section>
                <h2 className="text-xl sm:text-2xl font-semibold mb-4">Mostanában említve</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {recent.map(p => <PersonCard key={p.id} p={p} />)}
                </div>
              </section>
            )}

            {crossPodcast.length > 0 && (
              <section>
                <h2 className="text-xl sm:text-2xl font-semibold mb-4">Több műsorban szerepel</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {crossPodcast.map(p => <PersonCard key={p.id} p={p} />)}
                </div>
              </section>
            )}

            {featured.length > 0 && (
              <section>
                <h2 className="text-xl sm:text-2xl font-semibold mb-4">Érdemes felfedezni</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {featured.map(p => <PersonCard key={p.id} p={p} />)}
                </div>
              </section>
            )}

            {!loading && recent.length === 0 && crossPodcast.length === 0 && featured.length === 0 && (
              <div className="text-muted-foreground text-sm">Még nincs elérhető személy.</div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
