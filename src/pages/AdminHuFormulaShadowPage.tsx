import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import Layout from "@/components/Layout";
import { useNoindex } from "@/lib/useNoindex";
import { useAdminAccess } from "@/hooks/useAdminAccess";

// Admin diff view for HU_v1 shadow scoring.
// Read-only: shows live tier vs HU_v1 candidate tier and component breakdown.
// Live ranking fields are NEVER mutated from this page.

type Row = {
  id: string;
  title: string;
  rank_label: string | null;
  podiverzum_rank: number | null;
  shadow_rank_components: any;
};

const TIER_ORDER: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1, E: 0 };

function tierDelta(live: string | null | undefined, hu: string | null | undefined): number {
  const l = TIER_ORDER[String(live || "")] ?? 0;
  const h = TIER_ORDER[String(hu || "")] ?? 0;
  return h - l;
}

function TierBadge({ tier }: { tier: string | null | undefined }) {
  const t = String(tier || "—");
  const color: Record<string, string> = {
    S: "bg-yellow-500/20 text-yellow-700 border-yellow-500/40",
    A: "bg-emerald-500/20 text-emerald-700 border-emerald-500/40",
    B: "bg-sky-500/20 text-sky-700 border-sky-500/40",
    C: "bg-muted text-muted-foreground border-border",
    D: "bg-orange-500/20 text-orange-700 border-orange-500/40",
    E: "bg-rose-500/20 text-rose-700 border-rose-500/40",
  };
  return <Badge variant="outline" className={color[t] || ""}>{t}</Badge>;
}

export default function AdminHuFormulaShadowPage() {
  useNoindex("HU Formula Shadow — Admin");
  const { loading: adminLoading, isAdmin } = useAdminAccess();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string>("");
  const [tab, setTab] = useState("upgrades");

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("podcasts")
      .select("id,title,rank_label,podiverzum_rank,shadow_rank_components")
      .or("language.ilike.hu%,language_decision.eq.accept_hungarian,language_decision.eq.review_uncertain")
      .not("shadow_rank_components", "is", null)
      .limit(2000);
    const filtered = (data || []).filter((r: any) => r.shadow_rank_components && r.shadow_rank_components.hu_v1);
    setRows(filtered as Row[]);
    setLoading(false);
  }

  useEffect(() => {
    if (adminLoading || !isAdmin) return;
    load();
  }, [adminLoading, isAdmin]);

  async function runShadow() {
    if (!isAdmin) return;
    setRunning(true);
    setRunMsg("Running HU_v1 shadow scoring…");
    try {
      const { data, error } = await supabase.functions.invoke("hu-formula-v1-shadow", {
        body: { limit: 800 },
      });
      if (error) throw error;
      setRunMsg(`OK: considered=${(data as any)?.considered} written=${(data as any)?.written}`);
      await load();
    } catch (e: any) {
      setRunMsg(`Error: ${e?.message || String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  const enriched = useMemo(() => rows.map(r => {
    const hu = r.shadow_rank_components?.hu_v1 || {};
    return {
      ...r,
      hu_tier: hu.hu_candidate_tier,
      hu_score: Number(hu.final_hu_score) || 0,
      delta: tierDelta(r.rank_label, hu.hu_candidate_tier),
      market_pop: Number(hu.market_popularity_score) || 0,
      feed_health: Number(hu.feed_health_score) || 0,
      activity: Number(hu.activity_score) || 0,
      content: Number(hu.content_quality_score) || 0,
      platform: Number(hu.platform_availability_score) || 0,
      curation: Number(hu.curation_boost) || 0,
      news_like: !!hu.news_like,
      bulletin_like: !!hu.bulletin_like,
      lang_flag: hu.language_gate_flag,
      sources: Array.isArray(hu.market_sources) ? hu.market_sources : [],
      source_count: Number(hu.market_source_count) || 0,
      chart_stale: !!hu.chart_stale,
      chart_freshness: Array.isArray(hu.chart_freshness) ? hu.chart_freshness : [],
    };
  }), [rows]);

  const upgrades = useMemo(() => [...enriched].filter(r => r.delta > 0).sort((a,b) => b.delta - a.delta || b.hu_score - a.hu_score).slice(0, 100), [enriched]);
  const downgrades = useMemo(() => [...enriched].filter(r => r.delta < 0).sort((a,b) => a.delta - b.delta || a.hu_score - b.hu_score).slice(0, 100), [enriched]);
  const huMismatch = useMemo(() => enriched.filter(r => r.lang_flag === "hu_metadata_mismatch").sort((a,b) => b.hu_score - a.hu_score), [enriched]);
  const foreignFP = useMemo(() => enriched.filter(r => r.lang_flag === "accepted_foreign_false_positive").sort((a,b) => b.hu_score - a.hu_score), [enriched]);
  const newsLike = useMemo(() => enriched.filter(r => r.news_like).sort((a,b) => b.hu_score - a.hu_score), [enriched]);
  const bulletinLike = useMemo(() => enriched.filter(r => r.bulletin_like).sort((a,b) => b.hu_score - a.hu_score), [enriched]);
  const undervalued = useMemo(() => enriched.filter(r => r.market_pop >= 1 && (TIER_ORDER[String(r.rank_label||"")] ?? 0) <= 3).sort((a,b) => b.market_pop - a.market_pop), [enriched]);

  // Chart freshness from any scored row (same for all in a run).
  const chartFreshness = useMemo(() => enriched.find(r => r.chart_freshness.length > 0)?.chart_freshness || [], [enriched]);
  const anyChartStale = chartFreshness.some((c: any) => c.stale);

  if (adminLoading) return <Layout><div className="container mx-auto py-20">Betöltés…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Nincs jogosultság.</div></Layout>;

  function flagBadge(flag: string | undefined) {
    if (!flag) return null;
    const map: Record<string,string> = {
      confirmed_hungarian: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
      hu_metadata_mismatch: "bg-amber-500/15 text-amber-700 border-amber-500/30",
      accepted_foreign_false_positive: "bg-rose-500/15 text-rose-700 border-rose-500/30",
      needs_language_review: "bg-sky-500/15 text-sky-700 border-sky-500/30",
      likely_foreign: "bg-rose-500/10 text-rose-700 border-rose-500/30",
      confirmed_foreign: "bg-rose-500/20 text-rose-800 border-rose-500/40",
      unknown: "bg-muted text-muted-foreground border-border",
    };
    if (flag === "confirmed_hungarian") return null;
    return <Badge variant="outline" className={map[flag] || ""}>{flag}</Badge>;
  }

  function Table({ data }: { data: typeof enriched }) {
    return (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-2">Podcast</th>
              <th className="p-2">Live</th>
              <th className="p-2">HU_v1</th>
              <th className="p-2">HU score</th>
              <th className="p-2">Δ</th>
              <th className="p-2">Market</th>
              <th className="p-2">Charts</th>
              <th className="p-2">Feed</th>
              <th className="p-2">Act</th>
              <th className="p-2">Cont</th>
              <th className="p-2">Plat</th>
              <th className="p-2">Cur</th>
              <th className="p-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2 max-w-[260px] truncate" title={r.title}>{r.title}</td>
                <td className="p-2"><TierBadge tier={r.rank_label} /></td>
                <td className="p-2"><TierBadge tier={r.hu_tier} /></td>
                <td className="p-2 tabular-nums">{r.hu_score.toFixed(2)}</td>
                <td className="p-2 tabular-nums">{r.delta > 0 ? `+${r.delta}` : r.delta}</td>
                <td className="p-2 tabular-nums">{r.market_pop.toFixed(2)}</td>
                <td className="p-2 text-xs whitespace-nowrap" title={JSON.stringify(r.sources)}>
                  {r.source_count > 0
                    ? r.sources.map((s: any) => `${s.source[0].toUpperCase()}#${s.rank}`).join(" ")
                    : "—"}
                </td>
                <td className="p-2 tabular-nums">{r.feed_health.toFixed(2)}</td>
                <td className="p-2 tabular-nums">{r.activity.toFixed(2)}</td>
                <td className="p-2 tabular-nums">{r.content.toFixed(2)}</td>
                <td className="p-2 tabular-nums">{r.platform.toFixed(2)}</td>
                <td className="p-2 tabular-nums">{r.curation.toFixed(2)}</td>
                <td className="p-2 space-x-1">
                  {r.news_like && <Badge variant="outline">news</Badge>}
                  {r.bulletin_like && <Badge variant="outline" className="bg-orange-500/15 text-orange-700 border-orange-500/30">bulletin</Badge>}
                  {flagBadge(r.lang_flag)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <main className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">HU Formula v1 — Shadow Diff</h1>
          <p className="text-sm text-muted-foreground">
            Read-only Hungarian ranking proposal. Live <code>rank_label</code> and <code>podiverzum_rank</code> are NOT modified.
            Formula C is paused (cron dry-run). Writes only to <code>shadow_rank_components.hu_v1</code>.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Button variant="outline" onClick={load} disabled={loading}>Reload</Button>
          <Button onClick={runShadow} disabled={running}>{running ? "Running…" : "Run shadow (800)"}</Button>
        </div>
      </div>

      {runMsg && <Card className="p-3 text-sm">{runMsg}</Card>}

      {chartFreshness.length > 0 && (
        <Card className={`p-3 text-sm ${anyChartStale ? "border-amber-500/60 bg-amber-500/5" : ""}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">Chart freshness:</span>
            {chartFreshness.map((c: any) => (
              <Badge key={c.source} variant="outline" className={c.stale ? "bg-amber-500/15 text-amber-700 border-amber-500/40" : ""}>
                {c.source}: {c.latest ? new Date(c.latest).toISOString().slice(0,10) : "—"} ({c.days_old}d, {c.rows} rows){c.stale ? " · STALE" : ""}
              </Badge>
            ))}
            {anyChartStale && <span className="text-amber-700">⚠ at least one chart source is &gt;7d old — market_popularity may under-represent currently popular shows.</span>}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
        <Card className="p-3"><div className="text-muted-foreground">Scored</div><div className="text-xl font-semibold">{enriched.length}</div></Card>
        <Card className="p-3"><div className="text-muted-foreground">Upgrades</div><div className="text-xl font-semibold">{upgrades.length}</div></Card>
        <Card className="p-3"><div className="text-muted-foreground">Downgrades</div><div className="text-xl font-semibold">{downgrades.length}</div></Card>
        <Card className="p-3"><div className="text-muted-foreground">HU meta mismatch</div><div className="text-xl font-semibold">{huMismatch.length}</div></Card>
        <Card className="p-3"><div className="text-muted-foreground">Foreign FP</div><div className="text-xl font-semibold">{foreignFP.length}</div></Card>
        <Card className="p-3"><div className="text-muted-foreground">News / Bulletin</div><div className="text-xl font-semibold">{newsLike.length} / {bulletinLike.length}</div></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="upgrades">Top upgrades</TabsTrigger>
          <TabsTrigger value="downgrades">Top downgrades</TabsTrigger>
          <TabsTrigger value="undervalued">Popular but low rank</TabsTrigger>
          <TabsTrigger value="hu_mismatch">HU metadata mismatch</TabsTrigger>
          <TabsTrigger value="foreign_fp">Foreign false-positive</TabsTrigger>
          <TabsTrigger value="news">News-like</TabsTrigger>
          <TabsTrigger value="bulletin">Bulletin-like</TabsTrigger>
        </TabsList>
        <TabsContent value="upgrades"><Table data={upgrades} /></TabsContent>
        <TabsContent value="downgrades"><Table data={downgrades} /></TabsContent>
        <TabsContent value="undervalued"><Table data={undervalued} /></TabsContent>
        <TabsContent value="hu_mismatch"><Table data={huMismatch} /></TabsContent>
        <TabsContent value="foreign_fp"><Table data={foreignFP} /></TabsContent>
        <TabsContent value="news"><Table data={newsLike} /></TabsContent>
        <TabsContent value="bulletin"><Table data={bulletinLike} /></TabsContent>
      </Tabs>
    </main>
  );
}
