import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import Layout from "@/components/Layout";
import { useNoindex } from "@/lib/useNoindex";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { Sparkles, Database, Search as SearchIcon, Users, Hash, FileText, Layers, Activity } from "lucide-react";

type Row = {
  module: string;
  layer: string;
  coverage: string;
  fallback: string;
  status: "live" | "partial" | "gated" | "off";
  icon: ComponentType<{ className?: string }>;
};

type Counts = {
  episodes: number;
  aiSummary: number;
  embeddings: number;
  entities: number;
  cleanText: number;
  chunks: number;
  formulaC: number;
  podcasts: number;
  peoplePublic: number;
  peopleTotal: number;
  bios: number;
};

const empty: Counts = {
  episodes: 0, aiSummary: 0, embeddings: 0, entities: 0, cleanText: 0,
  chunks: 0, formulaC: 0, podcasts: 0, peoplePublic: 0, peopleTotal: 0, bios: 0,
};

function pct(n: number, d: number) {
  if (!d) return "—";
  return ((n / d) * 100).toFixed(1) + "%";
}

export default function AdminDataCoveragePage() {
  useNoindex("Data Coverage — Admin");
  const { loading: adminLoading, isAdmin } = useAdminAccess();
  const [c, setC] = useState<Counts>(empty);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (adminLoading || !isAdmin) return;
    (async () => {
      const [eps, aiSum, emb, ents, clean, chunks, fc, pods, ppub, ptot, bios] = await Promise.all([
        supabase.from("episodes").select("id", { count: "estimated", head: true }),
        supabase.from("episodes").select("id", { count: "estimated", head: true }).not("ai_summary", "is", null),
        supabase.from("episode_embeddings").select("episode_id", { count: "estimated", head: true }),
        supabase.from("episodes").select("id", { count: "estimated", head: true }).gte("ai_entities_version", 1),
        supabase.from("episode_clean_text").select("episode_id", { count: "estimated", head: true }),
        supabase.from("episode_chunks").select("episode_id", { count: "estimated", head: true }),
        supabase.from("podcasts").select("id", { count: "estimated", head: true }).in("rank_label", ["S", "A", "B", "C", "D", "E"]),
        supabase.from("podcasts").select("id", { count: "estimated", head: true }),
        supabase.from("people").select("id", { count: "exact", head: true }).eq("is_public", true),
        supabase.from("people").select("id", { count: "exact", head: true }),
        supabase.from("people").select("id", { count: "exact", head: true }).eq("ai_bio_status", "done"),
      ]);
      setC({
        episodes: eps.count ?? 0,
        aiSummary: aiSum.count ?? 0,
        embeddings: emb.count ?? 0,
        entities: ents.count ?? 0,
        cleanText: clean.count ?? 0,
        chunks: chunks.count ?? 0,
        formulaC: fc.count ?? 0,
        podcasts: pods.count ?? 0,
        peoplePublic: ppub.count ?? 0,
        peopleTotal: ptot.count ?? 0,
        bios: bios.count ?? 0,
      });
      setLoading(false);
    })();
  }, [adminLoading, isAdmin]);

  if (adminLoading) return <Layout><div className="container mx-auto py-20">Betöltés…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Nincs jogosultság.</div></Layout>;

  const rows: Row[] = [
    { icon: Sparkles, module: "Epizód kártya — leírás", layer: "ai_summary", coverage: pct(c.aiSummary, c.episodes), fallback: "clean_text → RSS leírás", status: "live" },
    { icon: FileText, module: "Epizód oldal — meta / OG / JSON-LD", layer: "ai_summary", coverage: pct(c.aiSummary, c.episodes), fallback: "clean_text → RSS leírás", status: "live" },
    { icon: Layers, module: "Hasonló epizódok", layer: "episode_embeddings", coverage: pct(c.embeddings, c.episodes), fallback: "—", status: "live" },
    { icon: SearchIcon, module: "Kereső — szemantikus", layer: "episode_embeddings + FTS + Cohere", coverage: pct(c.embeddings, c.episodes), fallback: "FTS only", status: "live" },
    { icon: SearchIcon, module: "Kereső — személynév (szigorú)", layer: "person_aliases (exact gate)", coverage: "n/a", fallback: "nincs (gate)", status: "live" },
    { icon: Hash, module: "Entity chip-ek epizódon", layer: "ai_entities (people/companies/topics/tickers)", coverage: pct(c.entities, c.episodes), fallback: "—", status: "live" },
    { icon: Activity, module: "Homepage trending / evergreen", layer: "Formula C + embeddings", coverage: pct(c.formulaC, c.podcasts), fallback: "freshness", status: "live" },
    { icon: Hash, module: "Téma- és személyoldalak listái", layer: "entities + embeddings", coverage: pct(c.entities, c.episodes), fallback: "FTS", status: "live" },
    { icon: Users, module: "Személyek hub (publikus)", layer: "people (gated)", coverage: pct(c.peoplePublic, c.peopleTotal), fallback: "—", status: "partial" },
    { icon: Sparkles, module: "Személy bio", layer: "people.ai_bio", coverage: pct(c.bios, c.peopleTotal), fallback: "rejtve / templated rövid", status: "gated" },
    { icon: FileText, module: "Clean text (hirdetés-szűrt)", layer: "episode_clean_text", coverage: pct(c.cleanText, c.episodes), fallback: "RSS leírás (drain alatt)", status: "partial" },
    { icon: Database, module: "Chunk embeddings (publikus kereső)", layer: "episode_chunks", coverage: pct(c.chunks, c.episodes), fallback: "nincs használatban", status: "gated" },
  ];

  return (
    <Layout>
      <div className="container mx-auto py-8 max-w-6xl space-y-6">
        <header>
          <h1 className="text-2xl sm:text-3xl font-semibold">Data Coverage</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Melyik publikus modul melyik adat-rétegre épül és milyen lefedettséggel. Élő számlálás.
          </p>
        </header>

        {loading && <div className="text-sm text-muted-foreground">Betöltés…</div>}

        <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Episodes" value={c.episodes} />
          <Stat label="AI summary" value={c.aiSummary} sub={pct(c.aiSummary, c.episodes)} />
          <Stat label="Episode embeddings" value={c.embeddings} sub={pct(c.embeddings, c.episodes)} />
          <Stat label="Entity backfill" value={c.entities} sub={pct(c.entities, c.episodes)} />
          <Stat label="Clean text" value={c.cleanText} sub={pct(c.cleanText, c.episodes)} />
          <Stat label="Chunks" value={c.chunks} sub={pct(c.chunks, c.episodes)} />
          <Stat label="People public" value={c.peoplePublic} sub={pct(c.peoplePublic, c.peopleTotal)} />
          <Stat label="AI bios" value={c.bios} sub={pct(c.bios, c.peopleTotal)} />
        </section>

        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">Modul</th>
                <th className="text-left p-3">Réteg</th>
                <th className="text-left p-3">Lefedettség</th>
                <th className="text-left p-3">Fallback</th>
                <th className="text-left p-3">Státusz</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const Icon = r.icon;
                const tone =
                  r.status === "live" ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
                  : r.status === "partial" ? "text-amber-500 border-amber-500/30 bg-amber-500/10"
                  : r.status === "gated" ? "text-muted-foreground border-border bg-secondary"
                  : "text-destructive border-destructive/30 bg-destructive/10";
                return (
                  <tr key={r.module} className="border-t border-border/60">
                    <td className="p-3 flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{r.module}</span>
                    </td>
                    <td className="p-3 text-muted-foreground font-mono text-xs">{r.layer}</td>
                    <td className="p-3 font-semibold">{r.coverage}</td>
                    <td className="p-3 text-muted-foreground text-xs">{r.fallback}</td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] border ${tone}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          Forrás: élő COUNT a <code>episodes</code>, <code>episode_embeddings</code>, <code>episode_clean_text</code>,
          <code>episode_chunks</code>, <code>podcasts</code>, <code>people</code> táblákon.
          Chunk- és clean-text rétegek továbbra is drain alatt; a publikus kereső nem függ tőlük.
        </p>
      </div>
    </Layout>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="p-3 rounded-lg border border-border bg-card">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-1">{value.toLocaleString("hu-HU")}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
