import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import PersonAvatar from "@/components/PersonAvatar";

interface PersonLite {
  id: string;
  slug: string;
  name: string;
  episode_count: number;
  podcast_count: number;
  latest_episode_at: string | null;
}

export default function PeopleHubPage() {
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [trending, setTrending] = useState<PersonLite[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const baseCols = "id, slug, name, episode_count, podcast_count, latest_episode_at";
      // Browsable hub only — single-podcast/weak people may remain indexable but are hidden from the hub.
      const baseQuery = supabase
        .from("people")
        .select(baseCols)
        .eq("is_public", true)
        .eq("is_browsable_in_people_hub", true)
        .in("activation_status", ["indexable", "public_noindex", "manual_approved"])
        .neq("ai_review_status", "needs_human_review")
        .neq("ai_review_status", "duplicate_candidate");

      const { data: all } = await baseQuery
        .order("episode_count", { ascending: false })
        .limit(200);
      setPeople((all || []) as any);

      const { data: tr } = await supabase
        .from("people")
        .select(baseCols)
        .eq("is_public", true)
        .eq("is_browsable_in_people_hub", true)
        .in("activation_status", ["indexable", "public_noindex", "manual_approved"])
        .neq("ai_review_status", "needs_human_review")
        .neq("ai_review_status", "duplicate_candidate")
        .not("latest_episode_at", "is", null)
        .order("latest_episode_at", { ascending: false })
        .limit(12);
      setTrending((tr || []) as any);
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
    ? people.filter(p => p.name.toLowerCase().includes(q.toLowerCase().trim()))
    : people;

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 sm:py-14 max-w-5xl">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Személyek</div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mt-2">Személyek magyar podcastokban</h1>
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

      <div className="container mx-auto py-10 max-w-5xl space-y-10">
        {trending.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Mostanában említve</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {trending.map(p => <PersonRow key={p.id} p={p} />)}
            </div>
          </section>
        )}
        <section>
          <h2 className="text-xl font-semibold mb-3">Legtöbb epizódban</h2>
          {loading && <div className="text-muted-foreground">Betöltés…</div>}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.slice(0, 60).map(p => <PersonRow key={p.id} p={p} />)}
          </div>
          {!loading && filtered.length === 0 && (
            <div className="text-muted-foreground text-sm">Nincs találat.</div>
          )}
        </section>
      </div>
    </Layout>
  );
}

function PersonRow({ p }: { p: PersonLite }) {
  return (
    <Link to={`/szemelyek/${p.slug}`} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card/70 hover:border-primary/40 transition-colors">
      <PersonAvatar name={p.name} size="md" />
      <div className="min-w-0">
        <div className="font-medium truncate">{p.name}</div>
        <div className="text-xs text-muted-foreground">{p.episode_count} epizód · {p.podcast_count} műsor</div>
      </div>
    </Link>
  );
}
