import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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

  useEffect(() => { load(); }, []);

  async function runShadow() {
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
      sources: hu.market_sources || [],
    };
  }), [rows]);

  const upgrades = useMemo(() => [...enriched].filter(r => r.delta > 0).sort((a,b) => b.delta - a.delta || b.hu_score - a.hu_score).slice(0, 100), [enriched]);
  const downgrades = useMemo(() => [...enriched].filter(r => r.delta < 0).sort((a,b) => a.delta - b.delta || a.hu_score - b.hu_score).slice(0, 100), [enriched]);
  const mismatch = useMemo(() => enriched.filter(r => r.lang_flag === "accepted_hungarian_metadata_mismatch").sort((a,b) => b.hu_score - a.hu_score), [enriched]);
  const newsLike = useMemo(() => enriched.filter(r => r.news_like).sort((a,b) => b.hu_score - a.hu_score), [enriched]);
  const undervalued = useMemo(() => enriched.filter(r => r.market_pop >= 1 && (TIER_ORDER[String(r.rank_label||"")] ?? 0) <= 3).sort((a,b) => b.market_pop - a.market_pop), [enriched]);

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
                <td className="p-2 tabular-nums">{r.feed_health.toFixed(2)}</td>
                <td className="p-2 tabular-nums">{r.activity.toFixed(2)}</td>
                <td className="p-2 tabular-nums">{r.content.toFixed(2)}</td>
                <td className="p-2 tabular-nums">{r.platform.toFixed(2)}</td>
                <td className="p-2 tabular-nums">{r.curation.toFixed(2)}</td>
                <td className="p-2 space-x-1">
                  {r.news_like && <Badge variant="outline">news</Badge>}
                  {r.bulletin_like && <Badge variant="outline">bulletin</Badge>}
                  {r.lang_flag === "accepted_hungarian_metadata_mismatch" && <Badge variant="outline">lang-mismatch</Badge>}
                  {r.lang_flag === "needs_language_review" && <Badge variant="outline">lang-review</Badge>}
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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <Card className="p-3"><div className="text-muted-foreground">Scored</div><div className="text-xl font-semibold">{enriched.length}</div></Card>
        <Card className="p-3"><div className="text-muted-foreground">Upgrades</div><div className="text-xl font-semibold">{upgrades.length}</div></Card>
        <Card className="p-3"><div className="text-muted-foreground">Downgrades</div><div className="text-xl font-semibold">{downgrades.length}</div></Card>
        <Card className="p-3"><div className="text-muted-foreground">Lang mismatch</div><div className="text-xl font-semibold">{mismatch.length}</div></Card>
        <Card className="p-3"><div className="text-muted-foreground">News-like</div><div className="text-xl font-semibold">{newsLike.length}</div></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="upgrades">Top upgrades</TabsTrigger>
          <TabsTrigger value="downgrades">Top downgrades</TabsTrigger>
          <TabsTrigger value="undervalued">Popular but low rank</TabsTrigger>
          <TabsTrigger value="mismatch">Lang metadata mismatch</TabsTrigger>
          <TabsTrigger value="news">News / bulletin-like</TabsTrigger>
        </TabsList>
        <TabsContent value="upgrades"><Table data={upgrades} /></TabsContent>
        <TabsContent value="downgrades"><Table data={downgrades} /></TabsContent>
        <TabsContent value="undervalued"><Table data={undervalued} /></TabsContent>
        <TabsContent value="mismatch"><Table data={mismatch} /></TabsContent>
        <TabsContent value="news"><Table data={newsLike} /></TabsContent>
      </Tabs>
    </main>
  );
}
