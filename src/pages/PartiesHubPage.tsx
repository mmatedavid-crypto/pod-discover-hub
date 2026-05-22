import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import OrgCard, { OrgCardData } from "@/components/OrgCard";

const PAGE_SIZE = 60;

async function fetchParties(search: string | null, limit: number, offset: number) {
  let q = supabase
    .from("organizations")
    .select(
      "id, slug, name, org_type, short_description_hu, ai_bio, wikipedia_extract, logo_url, gated_episode_count, gated_podcast_count, political_color, latest_episode_at, editorial_priority_level",
      { count: "exact" },
    )
    .eq("is_indexable", true)
    .eq("org_type", "party");
  if (search && search.length >= 2) q = q.ilike("name", `%${search}%`);
  q = q
    .order("editorial_priority_level", { ascending: false })
    .order("gated_episode_count", { ascending: false })
    .range(offset, offset + limit - 1);
  const { data, error, count } = await q;
  if (error) {
    console.error("parties fetch error", error);
    return { rows: [] as OrgCardData[], total: 0 };
  }
  return { rows: (data || []) as any as OrgCardData[], total: count || 0 };
}

export default function PartiesHubPage() {
  const [list, setList] = useState<OrgCardData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSeo({
      title: "Politikai pártok magyar podcastokban — Podiverzum",
      description:
        "Magyar politikai pártok és frakciók, amelyek a podcastokban szóba kerülnek. Aktivitás, kapcsolódó epizódok és vezetők.",
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => setPage(0), [debouncedQ]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const search = debouncedQ.length >= 2 ? debouncedQ : null;
      const { rows, total } = await fetchParties(search, PAGE_SIZE, page * PAGE_SIZE);
      setList(rows);
      setTotal(total);
      setLoading(false);
    })();
  }, [debouncedQ, page]);

  const totalPages = useMemo(() => Math.ceil(total / PAGE_SIZE), [total]);
  const isSearching = debouncedQ.length >= 2;

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 sm:py-14 max-w-5xl px-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Pártok</div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mt-2">
            Politikai pártok a magyar podcastvilágban
          </h1>
          <p className="text-foreground/80 mt-4 max-w-2xl">
            Magyar politikai pártok és frakciók, amelyek a közéleti podcastokban előkerülnek — aktivitás,
            kapcsolódó epizódok és politikai szín szerint.
          </p>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Keress pártot…"
            className="mt-6 w-full max-w-md px-3 py-2 rounded-md bg-card border border-border focus:border-primary/60 outline-none text-sm"
          />
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl px-4 space-y-6">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl sm:text-2xl font-semibold">
              {isSearching ? "Találatok" : "Pártok"}
            </h2>
            {total > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {isSearching
                  ? `${total.toLocaleString("hu-HU")} találat a(z) „${debouncedQ}” keresésre.`
                  : `${total.toLocaleString("hu-HU")} párt a katalógusban.`}
              </p>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-muted-foreground text-sm">Betöltés…</div>
        ) : list.length === 0 ? (
          isSearching ? (
            <div className="text-muted-foreground text-sm">Nincs találat.</div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
              Még gyűjtjük a pártokat az epizódokból. Hamarosan itt jelennek meg.
            </div>
          )
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
      </div>
    </Layout>
  );
}
