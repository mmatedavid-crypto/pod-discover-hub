import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import PersonCard, { PersonCardData } from "@/components/PersonCard";

interface PersonRow extends PersonCardData {
  id: string;
  people_hub_score: number;
  gated_episode_count: number;
  gated_podcast_count: number;
  distinct_podcast_count: number;
  host_count: number;
  guest_count: number;
  strong_mention_count: number;
  recent_relevant_episode_count_30d: number;
  total_count?: number;
}

const TOP_LIMIT = 60;
const PAGE_SIZE = 60;

async function fetchPeople(limit: number, offset: number, search: string | null) {
  const { data, error } = await supabase.rpc("list_people_hub", {
    p_limit: limit,
    p_offset: offset,
    p_search: search,
  });
  if (error) {
    console.error("list_people_hub error", error);
    return { rows: [] as PersonRow[], total: 0 };
  }
  const rows = (data || []) as PersonRow[];
  const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
  return { rows, total };
}

export default function PeopleHubPage() {
  const [top, setTop] = useState<PersonRow[]>([]);
  const [list, setList] = useState<PersonRow[]>([]);
  const [totalAll, setTotalAll] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loadingTop, setLoadingTop] = useState(true);
  const [loadingList, setLoadingList] = useState(true);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Top 60 — load once
  useEffect(() => {
    (async () => {
      setLoadingTop(true);
      const { rows } = await fetchPeople(TOP_LIMIT, 0, null);
      setTop(rows);
      setLoadingTop(false);
      setSeo({
        title: "Személyek magyar podcastokban — Podiverzum",
        description:
          "Politikusok, üzleti vezetők, alkotók és gondolkodók, akik magyar podcastokban szerepelnek vagy szóba kerülnek. Böngészd a top 60-at vagy az összes személyt.",
        jsonLd: [
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "Személyek magyar podcastokban",
            url: typeof window !== "undefined" ? window.location.href.split("?")[0] : undefined,
          },
        ],
      });
    })();
  }, []);

  // Reset page when search changes
  useEffect(() => {
    setPage(0);
  }, [debouncedQ]);

  // Paginated/searchable "Összes" list
  useEffect(() => {
    (async () => {
      setLoadingList(true);
      const search = debouncedQ.length >= 2 ? debouncedQ : null;
      // When unfiltered, skip the first TOP_LIMIT on page 0 so the lists don't fully overlap
      const offset = search ? page * PAGE_SIZE : page * PAGE_SIZE + (page === 0 ? TOP_LIMIT : TOP_LIMIT);
      const { rows, total } = await fetchPeople(PAGE_SIZE, offset, search);
      setList(rows);
      setTotalAll(total);
      setLoadingList(false);
    })();
  }, [page, debouncedQ]);

  const isSearching = debouncedQ.length >= 2;
  const totalPages = useMemo(() => {
    if (isSearching) return Math.ceil(totalAll / PAGE_SIZE);
    // Subtract top 60 from listing pages when not searching
    const remaining = Math.max(0, totalAll - TOP_LIMIT);
    return Math.ceil(remaining / PAGE_SIZE);
  }, [totalAll, isSearching]);

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 sm:py-14 max-w-5xl px-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Személyek</div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mt-2">
            Személyek magyar podcastokban
          </h1>
          <p className="text-foreground/80 mt-4 max-w-2xl">
            Fedezd fel a magyar podcastvilág szereplőit: műsorvezetők, vendégek és gyakran említett közéleti személyek.
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
        {!isSearching && (
          <section>
            <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
              <div>
                <h2 className="text-xl sm:text-2xl font-semibold">Top {TOP_LIMIT}</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  A legnépszerűbb és legrelevánsabb személyek a magyar podcastvilágban.
                </p>
              </div>
              {totalAll > 0 && (
                <div className="text-xs text-muted-foreground">
                  Összesen {totalAll.toLocaleString("hu-HU")} személy
                </div>
              )}
            </div>
            {loadingTop ? (
              <div className="text-muted-foreground text-sm">Betöltés…</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {top.map((p) => (
                  <PersonCard key={p.id} p={enrich(p)} />
                ))}
              </div>
            )}
          </section>
        )}

        <section>
          <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold">
                {isSearching ? "Találatok" : "Összes személy"}
              </h2>
              {isSearching && (
                <p className="text-xs text-muted-foreground mt-1">
                  {totalAll.toLocaleString("hu-HU")} találat a(z) „{debouncedQ}” keresésre.
                </p>
              )}
            </div>
          </div>

          {loadingList ? (
            <div className="text-muted-foreground text-sm">Betöltés…</div>
          ) : list.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              {isSearching ? "Nincs találat." : "Nincs több személy."}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map((p) => (
                  <PersonCard key={p.id} p={enrich(p)} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="px-3 py-1.5 text-sm rounded-md border border-border bg-card disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary/40"
                  >
                    ← Előző
                  </button>
                  <div className="text-xs text-muted-foreground">
                    {page + 1}. oldal / {totalPages}
                  </div>
                  <button
                    type="button"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-1.5 text-sm rounded-md border border-border bg-card disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary/40"
                  >
                    Következő →
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </Layout>
  );
}

// Map RPC row → PersonCard input, adding a "gyakran említett személy" context line
// for people with mentions but no host/guest evidence.
function enrich(p: PersonRow): PersonCardData {
  const hasParticipation = (p.host_count || 0) + (p.guest_count || 0) > 0;
  const contextLine = !hasParticipation && (p.strong_mention_count || 0) > 0
    ? "Gyakran említett személy"
    : null;
  return {
    slug: p.slug,
    name: p.name,
    disambiguation_label: p.disambiguation_label ?? null,
    episode_count: p.gated_episode_count || p.episode_count || 0,
    podcast_count: p.gated_podcast_count || p.podcast_count || 0,
    latest_accepted_relevant_episode_at: p.latest_accepted_relevant_episode_at ?? null,
    short_bio: p.short_bio ?? null,
    ai_bio: p.ai_bio ?? null,
    context_line: contextLine,
  };
}
