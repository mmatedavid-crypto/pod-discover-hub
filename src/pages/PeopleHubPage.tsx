import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import PersonCard, { PersonCardData } from "@/components/PersonCard";

interface PersonRow extends PersonCardData {
  id: string;
  image_url?: string | null;
  people_hub_score: number;
  gated_episode_count: number;
  gated_podcast_count: number;
  distinct_podcast_count: number;
  host_count: number;
  guest_count: number;
  strong_mention_count: number;
  recent_relevant_episode_count_30d: number;
  identity_ambiguous?: boolean | null;
  manual_approved?: boolean | null;
  ai_bio_status?: string | null;
  ai_bio_confidence?: number | null;
  wikipedia_match_status?: string | null;
  wikipedia_match_confidence?: number | null;
  is_indexable?: boolean | null;
  activation_status?: string | null;
  ai_recommended_action?: string | null;
  ai_review_status?: string | null;
  identity_status?: string | null;
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
  const rows = (data || []) as unknown as PersonRow[];
  const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
  return { rows, total };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

type SortMode = "relevance" | "alpha";

function isSafePeopleHubPerson(p: Partial<PersonRow>): boolean {
  const trustedWiki = p.wikipedia_match_status === "verified" && Number(p.wikipedia_match_confidence || 0) >= 0.8;
  if (p.is_indexable === false) return false;
  if (p.activation_status === "inactive") return false;
  if (["hide", "reject"].includes(p.ai_recommended_action || "")) return false;
  if (["needs_human_review", "duplicate_candidate"].includes(p.ai_review_status || "")) return false;
  if (p.identity_status === "split_resolved") return false;
  if (p.identity_ambiguous && !p.manual_approved && !trustedWiki) return false;
  return true;
}

async function fetchPeopleAlpha(letter: string | null, limit: number, offset: number) {
  const { data, error } = await supabase.rpc("list_people_alpha", {
    p_letter: letter,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) {
    console.error("list_people_alpha error", error);
    return { rows: [] as PersonRow[], total: 0 };
  }
  const rows = (data || []) as unknown as PersonRow[];
  const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
  return { rows, total };
}

export default function PeopleHubPage() {
  const [top, setTop] = useState<PersonRow[]>([]);
  const [topicFigures, setTopicFigures] = useState<any[]>([]);
  const [list, setList] = useState<PersonRow[]>([]);
  const [totalAll, setTotalAll] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loadingTop, setLoadingTop] = useState(true);
  const [loadingList, setLoadingList] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("relevance");
  const [letter, setLetter] = useState<string | null>(null);
  const [letterCounts, setLetterCounts] = useState<Record<string, number>>({});

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
      setTop(rows.filter(isSafePeopleHubPerson));
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

  // International topic figures (Musk, Trump, …) — never participate, only discussed
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("people")
        .select("id, slug, name, image_url, disambiguation_label, short_bio, ai_bio, identity_ambiguous, manual_approved, ai_bio_status, ai_bio_confidence, wikipedia_match_status, wikipedia_match_confidence, is_indexable, activation_status, ai_recommended_action, ai_review_status, identity_status, gated_episode_count, gated_podcast_count, episode_count, podcast_count, latest_accepted_relevant_episode_at, topic_figure_origin, people_hub_score")
        .eq("persona", "topic_figure")
        .eq("is_public", true)
        .eq("is_indexable", true)
        .gte("gated_episode_count", 1)
        .order("people_hub_score", { ascending: false })
        .limit(18);
      setTopicFigures(((data || []) as any[]).filter(isSafePeopleHubPerson));
    })();
  }, []);

  // Letter counts — load once (used in alpha mode)
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("people_alpha_letter_counts");
      if (error) {
        console.error("people_alpha_letter_counts error", error);
        return;
      }
      const map: Record<string, number> = {};
      (data || []).forEach((r: any) => { map[r.letter] = Number(r.count); });
      setLetterCounts(map);
    })();
  }, []);

  // Reset page when search / sort / letter changes
  useEffect(() => {
    setPage(0);
  }, [debouncedQ, sortMode, letter]);

  // Paginated/searchable "Összes" list
  useEffect(() => {
    (async () => {
      setLoadingList(true);
      const search = debouncedQ.length >= 2 ? debouncedQ : null;

      if (sortMode === "alpha" && !search) {
        const { rows, total } = await fetchPeopleAlpha(letter, PAGE_SIZE, page * PAGE_SIZE);
        setList(rows.filter(isSafePeopleHubPerson));
        setTotalAll(total);
        setLoadingList(false);
        return;
      }

      const offset = search ? page * PAGE_SIZE : page * PAGE_SIZE + (page === 0 ? TOP_LIMIT : TOP_LIMIT);
      const { rows, total } = await fetchPeople(PAGE_SIZE, offset, search);
      setList(rows.filter(isSafePeopleHubPerson));
      setTotalAll(total);
      setLoadingList(false);
    })();
  }, [page, debouncedQ, sortMode, letter]);

  const isSearching = debouncedQ.length >= 2;
  const isAlpha = sortMode === "alpha" && !isSearching;
  const totalPages = useMemo(() => {
    if (isAlpha) return Math.ceil(totalAll / PAGE_SIZE);
    if (isSearching) return Math.ceil(totalAll / PAGE_SIZE);
    const remaining = Math.max(0, totalAll - TOP_LIMIT);
    return Math.ceil(remaining / PAGE_SIZE);
  }, [totalAll, isSearching, isAlpha]);

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 sm:py-14 max-w-5xl px-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Személyek</div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mt-2">
            Személyek magyar podcastokban
          </h1>
          <p className="text-foreground/80 mt-4 max-w-2xl">
            Fedezd fel a magyar podcastvilág kapcsolódó személyeit: műsorvezetők, tényleges megszólalók és gyakran említett közéleti nevek.
          </p>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Keress személyt…"
            className="mt-6 w-full max-w-md px-3 py-2 rounded-md bg-card border border-border focus:border-primary/60 outline-none text-sm"
          />
          <div className="mt-3 text-sm">
            <a href="/szemelyek/abc" className="text-primary hover:underline">Teljes A–Z lista →</a>
          </div>
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

        {!isSearching && topicFigures.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
              <div>
                <h2 className="text-xl sm:text-2xl font-semibold">Akikről beszélnek</h2>
                <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
                  Közéleti, történelmi, vallási, kulturális vagy nemzetközi szereplők, akikről gyakran szó esik a magyar podcastokban.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {topicFigures.map((p) => (
                <PersonCard
                  key={p.id}
                  p={{
                    slug: p.slug,
                    name: p.name,
                    image_url: p.image_url ?? null,
                    disambiguation_label: p.disambiguation_label ?? null,
                    episode_count: p.gated_episode_count || p.episode_count || 0,
                    podcast_count: p.gated_podcast_count || p.podcast_count || 0,
                    latest_accepted_relevant_episode_at: p.latest_accepted_relevant_episode_at ?? null,
                    short_bio: p.short_bio ?? null,
                    ai_bio: p.ai_bio ?? null,
                    identity_ambiguous: p.identity_ambiguous ?? null,
                    manual_approved: p.manual_approved ?? null,
                    ai_bio_status: p.ai_bio_status ?? null,
                    ai_bio_confidence: p.ai_bio_confidence ?? null,
                    wikipedia_match_status: p.wikipedia_match_status ?? null,
                    wikipedia_match_confidence: p.wikipedia_match_confidence ?? null,
                    context_line: p.topic_figure_origin === "international" ? "Nemzetközi szereplő" : "Akiről beszélnek",
                  }}
                />
              ))}
            </div>
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
                  „{debouncedQ}” keresésre {totalAll.toLocaleString("hu-HU")} találat.
                </p>
              )}
              {isAlpha && (
                <p className="text-xs text-muted-foreground mt-1">
                  {letter
                    ? `${totalAll.toLocaleString("hu-HU")} személy „${letter}” betűvel`
                    : `${totalAll.toLocaleString("hu-HU")} személy ABC sorrendben`}
                </p>
              )}
            </div>
            {!isSearching && (
              <div className="inline-flex rounded-md border border-border bg-card overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => { setSortMode("relevance"); setLetter(null); }}
                  className={`px-3 py-1.5 transition-colors ${sortMode === "relevance" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Relevancia
                </button>
                <button
                  type="button"
                  onClick={() => setSortMode("alpha")}
                  className={`px-3 py-1.5 border-l border-border transition-colors ${sortMode === "alpha" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
                >
                  ABC
                </button>
              </div>
            )}
          </div>

          {isAlpha && (
            <div className="mb-6 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setLetter(null)}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${letter === null ? "border-primary/60 bg-primary/15 text-primary font-medium" : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"}`}
              >
                Mind
              </button>
              {ALPHABET.map((L) => {
                const c = letterCounts[L] || 0;
                const disabled = c === 0;
                const active = letter === L;
                return (
                  <button
                    key={L}
                    type="button"
                    disabled={disabled}
                    onClick={() => setLetter(L)}
                    title={disabled ? "Nincs ilyen kezdőbetűs személy" : `${c} személy`}
                    className={`w-8 h-8 text-xs rounded-md border transition-colors ${
                      active
                        ? "border-primary/60 bg-primary/15 text-primary font-semibold"
                        : disabled
                          ? "border-border/40 bg-card/40 text-muted-foreground/40 cursor-not-allowed"
                          : "border-border bg-card text-foreground hover:border-primary/40"
                    }`}
                  >
                    {L}
                  </button>
                );
              })}
              {(letterCounts["#"] || 0) > 0 && (
                <button
                  type="button"
                  onClick={() => setLetter("#")}
                  className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${letter === "#" ? "border-primary/60 bg-primary/15 text-primary font-medium" : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"}`}
                  title={`${letterCounts["#"]} egyéb`}
                >
                  #
                </button>
              )}
            </div>
          )}

          {loadingList ? (
            <div className="text-muted-foreground text-sm">Betöltés…</div>
          ) : list.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              {isSearching ? "Nincs találat." : isAlpha && letter ? `Nincs „${letter}” kezdőbetűs személy.` : "Nincs több személy."}
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
    image_url: p.image_url ?? null,
    disambiguation_label: p.disambiguation_label ?? null,
    episode_count: p.gated_episode_count || p.episode_count || 0,
    podcast_count: p.gated_podcast_count || p.podcast_count || 0,
    latest_accepted_relevant_episode_at: p.latest_accepted_relevant_episode_at ?? null,
    short_bio: p.short_bio ?? null,
    ai_bio: p.ai_bio ?? null,
    identity_ambiguous: p.identity_ambiguous ?? null,
    manual_approved: p.manual_approved ?? null,
    ai_bio_status: p.ai_bio_status ?? null,
    ai_bio_confidence: p.ai_bio_confidence ?? null,
    wikipedia_match_status: p.wikipedia_match_status ?? null,
    wikipedia_match_confidence: p.wikipedia_match_confidence ?? null,
    context_line: contextLine,
  };
}
