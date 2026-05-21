import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import OrgCard, { OrgCardData, ORG_TYPE_LABEL } from "@/components/OrgCard";

type TabKey = "all" | "company" | "media" | "institution" | "ngo";

const TABS: { key: TabKey; label: string; types: string[] }[] = [
  { key: "all", label: "Összes", types: ["company", "media", "institution", "ngo"] },
  { key: "company", label: ORG_TYPE_LABEL.company + "ek", types: ["company"] },
  { key: "media", label: "Média", types: ["media", "radio_station"] },
  { key: "institution", label: "Intézmények", types: ["institution"] },
  { key: "ngo", label: "Civil szervezetek", types: ["ngo"] },
];

const TOP_LIMIT = 30;
const PAGE_SIZE = 60;

async function fetchOrgs(types: string[], search: string | null, limit: number, offset: number) {
  let q = supabase
    .from("organizations")
    .select(
      "id, slug, name, org_type, short_description_hu, ai_bio, wikipedia_extract, logo_url, gated_episode_count, gated_podcast_count, political_color, latest_episode_at",
      { count: "exact" },
    )
    .eq("is_public", true)
    .in("org_type", types)
    .gte("gated_episode_count", 1);
  if (search && search.length >= 2) q = q.ilike("name", `%${search}%`);
  q = q.order("gated_episode_count", { ascending: false }).range(offset, offset + limit - 1);
  const { data, error, count } = await q;
  if (error) {
    console.error("organizations fetch error", error);
    return { rows: [] as OrgCardData[], total: 0 };
  }
  return { rows: (data || []) as any as OrgCardData[], total: count || 0 };
}

export default function CompaniesHubPage() {
  const [tab, setTab] = useState<TabKey>("all");
  const [top, setTop] = useState<OrgCardData[]>([]);
  const [list, setList] = useState<OrgCardData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loadingTop, setLoadingTop] = useState(true);
  const [loadingList, setLoadingList] = useState(true);

  useEffect(() => {
    setSeo({
      title: "Cégek és intézmények magyar podcastokban — Podiverzum",
      description:
        "Cégek, intézmények, médiumok és civil szervezetek, amik a magyar podcastokban szóba kerülnek. Böngészd típus szerint vagy keress rá.",
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(0);
  }, [debouncedQ, tab]);

  const currentTypes = useMemo(() => TABS.find((t) => t.key === tab)!.types, [tab]);

  // Top
  useEffect(() => {
    (async () => {
      setLoadingTop(true);
      const { rows } = await fetchOrgs(currentTypes, null, TOP_LIMIT, 0);
      setTop(rows);
      setLoadingTop(false);
    })();
  }, [currentTypes]);

  // List
  useEffect(() => {
    (async () => {
      setLoadingList(true);
      const search = debouncedQ.length >= 2 ? debouncedQ : null;
      const offset = search ? page * PAGE_SIZE : page * PAGE_SIZE + TOP_LIMIT;
      const { rows, total } = await fetchOrgs(currentTypes, search, PAGE_SIZE, offset);
      setList(rows);
      setTotal(total);
      setLoadingList(false);
    })();
  }, [currentTypes, debouncedQ, page]);

  const isSearching = debouncedQ.length >= 2;
  const totalPages = useMemo(() => {
    if (isSearching) return Math.ceil(total / PAGE_SIZE);
    return Math.ceil(Math.max(0, total - TOP_LIMIT) / PAGE_SIZE);
  }, [total, isSearching]);

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 sm:py-14 max-w-5xl px-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Cégek és intézmények</div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mt-2">
            Cégek és intézmények
          </h1>
          <p className="text-foreground/80 mt-4 max-w-2xl">
            A magyar és nemzetközi szervezetek, amik a podcastokban szóba kerülnek — gazdasági, állami,
            média- és civil szereplők egy helyen.
          </p>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Keress szervezetet…"
            className="mt-6 w-full max-w-md px-3 py-2 rounded-md bg-card border border-border focus:border-primary/60 outline-none text-sm"
          />
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl px-4 space-y-10">
        {/* Tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-border/60 pb-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                tab === t.key
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {!isSearching && (
          <section>
            <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
              <div>
                <h2 className="text-xl sm:text-2xl font-semibold">Top {TOP_LIMIT}</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  A legtöbb epizódot generáló szervezetek a kiválasztott kategóriában.
                </p>
              </div>
              {total > 0 && (
                <div className="text-xs text-muted-foreground">
                  Összesen {total.toLocaleString("hu-HU")} szervezet
                </div>
              )}
            </div>
            {loadingTop ? (
              <div className="text-muted-foreground text-sm">Betöltés…</div>
            ) : top.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {top.map((o) => (
                  <OrgCard key={o.slug} o={o} />
                ))}
              </div>
            )}
          </section>
        )}

        <section>
          <div className="mb-4">
            <h2 className="text-xl sm:text-2xl font-semibold">
              {isSearching ? "Találatok" : "Összes szervezet"}
            </h2>
            {isSearching && (
              <p className="text-xs text-muted-foreground mt-1">
                {total.toLocaleString("hu-HU")} találat a(z) „{debouncedQ}” keresésre.
              </p>
            )}
          </div>
          {loadingList ? (
            <div className="text-muted-foreground text-sm">Betöltés…</div>
          ) : list.length === 0 ? (
            isSearching ? <div className="text-muted-foreground text-sm">Nincs találat.</div> : <EmptyState />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map((o) => (
                  <OrgCard key={o.slug} o={o} />
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

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
      Még gyűjtjük a szervezeteket az epizódokból. Az AI ~16 ezer epizódból már kinyerte a említett cégeket
      és intézményeket; ezek hamarosan itt jelennek meg.
    </div>
  );
}
