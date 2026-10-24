import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { healthBadgeVariant, healthLabel } from "@/lib/pipelineHealth";

type Item = {
  name: string;
  health: string;
  recommendation?: string;
  backlog?: number | null;
  backlog_label?: string;
  last_completion_at?: string | null;
  last_dispatch_at?: string | null;
  runs_24h?: { ok: number; error: number; killed: number; running: number };
  last_stage_completion_at?: string | null;
  by_stage?: Record<string, Record<string, number>>;
  block_reasons?: Record<string, number>;
  person_review_blocked?: number;
  dispatch?: { dispatched_today?: number; daily_cap?: number };
  progress_updated_at?: string | null;
};

type Snapshot = { generated_at: string; summary: Record<string, number>; items: Item[] };

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString("hu-HU", { dateStyle: "short", timeStyle: "short" }) : "–");

/** Admin view of get_pipeline_runner_health_v1 (light part of get_pipeline_health_snapshot_v1): real completions vs cron dispatch, freshness, intentional pauses. */
export default function PipelineHealthPanel() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase.rpc("get_pipeline_runner_health_v1");
    if (err) setError(err.message);
    else { setSnap(data as unknown as Snapshot); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const derivation = snap?.items.find((i) => i.name === "derivation_freshness");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Feldolgozási lánc – valós futások</CardTitle>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Frissítés
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && <p className="text-destructive">{error}</p>}
        {snap && (
          <>
            <div className="flex flex-wrap gap-2">
              {(["green", "yellow", "red", "paused"] as const).map((k) => (
                <Badge key={k} variant={healthBadgeVariant(k)}>{healthLabel(k)}: {snap.summary?.[k] ?? 0}</Badge>
              ))}
              <span className="text-muted-foreground">Mért: {fmt(snap.generated_at)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Lépés</th>
                    <th className="py-1 pr-3">Állapot</th>
                    <th className="py-1 pr-3">Utolsó valós befejezés</th>
                    <th className="py-1 pr-3">Utolsó ütemezés</th>
                    <th className="py-1 pr-3">24 óra (ok / hiba / leállt)</th>
                    <th className="py-1 pr-3">Hátralék</th>
                    <th className="py-1">Megjegyzés</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.items.map((it) => (
                    <tr key={it.name} className="border-t border-border align-top">
                      <td className="py-1 pr-3 font-medium">{it.name}</td>
                      <td className="py-1 pr-3"><Badge variant={healthBadgeVariant(it.health)}>{healthLabel(it.health)}</Badge></td>
                      <td className="py-1 pr-3">{fmt(it.last_completion_at ?? it.last_stage_completion_at ?? it.progress_updated_at)}</td>
                      <td className="py-1 pr-3">{fmt(it.last_dispatch_at)}</td>
                      <td className="py-1 pr-3">{it.runs_24h ? `${it.runs_24h.ok} / ${it.runs_24h.error} / ${it.runs_24h.killed}` : "–"}</td>
                      <td className="py-1 pr-3">{it.backlog ?? "–"}{it.backlog_label ? <div className="text-xs text-muted-foreground">{it.backlog_label}</div> : null}</td>
                      <td className="py-1 text-muted-foreground">{it.recommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {derivation?.by_stage && (
              <div className="space-y-2">
                <p className="font-medium">Származtatott eredmények frissessége (tisztított szöveg változása után)</p>
                <div className="grid gap-2 md:grid-cols-3">
                  {Object.entries(derivation.by_stage).map(([stage, counts]) => (
                    <div key={stage} className="rounded-md border border-border p-2">
                      <div className="font-medium">{stage}</div>
                      {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([status, n]) => (
                        <div key={status} className="flex justify-between"><span className="text-muted-foreground">{status}</span><span>{n}</span></div>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="text-muted-foreground">
                  Ma kiküldve: {derivation.dispatch?.dispatched_today ?? 0} / {derivation.dispatch?.daily_cap ?? "–"} ·
                  Fizetős személy-ellenőrzésre vár (szüneteltetve): {derivation.person_review_blocked ?? 0}
                </p>
                {derivation.block_reasons && Object.keys(derivation.block_reasons).length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {Object.entries(derivation.block_reasons).map(([r, n]) => <div key={r}>{r}: {n}</div>)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
