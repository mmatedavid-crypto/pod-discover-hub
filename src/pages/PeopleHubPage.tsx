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

const BASE_COLS = "id, slug, name, disambiguation_label, episode_count, podcast_count, distinct_podcast_count, strong_mention_count, recent_relevant_episode_count_30d, latest_accepted_relevant_episode_at, people_hub_score";

const baseFilter = () =>
  supabase
    .from("people")
    .select(BASE_COLS)
    .eq("is_public", true)
    .eq("is_browsable_in_people_hub", true)
    .in("activation_status", ["indexable", "public_noindex", "manual_approved"])
    .neq("ai_review_status", "needs_human_review")
    .neq("ai_review_status", "duplicate_candidate");

export default function PeopleHubPage() {
  const [recent, setRecent] = useState<PersonRow[]>([]);
  const [crossPodcast, setCrossPodcast] = useState<PersonRow[]>([]);
  const [featured, setFeatured] = useState<PersonRow[]>([]);
  const [searchPool, setSearchPool] = useState<PersonRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Section 1: recently mentioned (last 30d)
      const { data: recentData } = await baseFilter()
        .gt("recent_relevant_episode_count_30d", 0)
        .order("latest_accepted_relevant_episode_at", { ascending: false })
        .limit(12);

      // Section 2: cross-podcast relevance
      const { data: crossData } = await baseFilter()
        .gte("distinct_podcast_count", 2)
        .gte("strong_mention_count", 2)
        .order("people_hub_score", { ascending: false })
        .limit(18);

      // Section 3: featured conversations (top score)
      const { data: featuredData } = await baseFilter()
        .order("people_hub_score", { ascending: false })
        .limit(36);

      // Search pool
      const { data: poolData } = await baseFilter()
        .order("people_hub_score", { ascending: false })
        .limit(300);

      setRecent((recentData || []) as any);
      setCrossPodcast((crossData || []) as any);
      const crossIds = new Set((crossData || []).map((p: any) => p.id));
      setFeatured(((featuredData || []) as any[]).filter(p => !crossIds.has(p.id)).slice(0, 24));
      setSearchPool((poolData || []) as any);
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
            Fedezz fel embereket, akik magyar podcastokban szerepelnek vagy szóba kerülnek. Politikusok, üzleti vezetők, alkotók, kutatók.
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
                <h2 className="text-xl sm:text-2xl font-semibold mb-4">Kiemelt beszélgetések szereplői</h2>
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
