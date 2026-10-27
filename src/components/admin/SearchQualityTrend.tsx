import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type Agg = {
  queries: number;
  p_at_1: number | null;
  p_at_3: number | null;
  ndcg_at_10: number | null;
  top1_off_topic_rate: number | null;
  top3_off_topic_rate: number | null;
  empty_rate: number | null;
};

type QualityRun = {
  id: string;
  label: string;
  status: string;
  created_at: string;
  cost_used_usd: number;
  metrics: {
    search?: { overall?: Agg; by_query_type?: Record<string, Agg>; by_split?: Record<string, Agg>; latency_p50?: number | null };
    recommendation?: Record<string, Agg>;
    compared_to?: { label?: string; regressions?: Array<{ group: string; metric: string; before: number; after: number }> };
    judge_calibration?: { relevant_binary?: number; exact?: number } | null;
  } | null;
};

const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);

/** AI-graded whole-set search / recommendation quality per run (admin only). */
export default function SearchQualityTrend() {
  const [runs, setRuns] = useState<QualityRun[]>([]);

  useEffect(() => {
    supabase
      .from("search_quality_runs")
      .select("id,label,status,created_at,cost_used_usd,metrics")
      .order("created_at", { ascending: false })
      .limit(12)
      .then(({ data }) => setRuns(((data || []) as unknown as QualityRun[]).filter((r) => r.status !== "cancelled")));
  }, []);

  if (!runs.length) return null;
  const latest = runs.find((r) => r.metrics?.search?.by_query_type);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search quality (AI-graded, whole set)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead>Queries</TableHead>
              <TableHead>Top-1 on topic</TableHead>
              <TableHead>Top-3 precision</TableHead>
              <TableHead>Top-1 off topic</TableHead>
              <TableHead>Empty</TableHead>
              <TableHead>Holdout top-3</TableHead>
              <TableHead>Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => {
              const o = r.metrics?.search?.overall;
              const regs = r.metrics?.compared_to?.regressions || [];
              return (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[280px]">
                    <div className="font-medium truncate">{r.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("hu-HU")} · {r.status}
                      {regs.length > 0 && <Badge variant="destructive" className="ml-2">{regs.length} regression</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>{o?.queries ?? "–"}</TableCell>
                  <TableCell>{pct(o?.p_at_1)}</TableCell>
                  <TableCell>{pct(o?.p_at_3)}</TableCell>
                  <TableCell>{pct(o?.top1_off_topic_rate)}</TableCell>
                  <TableCell>{pct(o?.empty_rate)}</TableCell>
                  <TableCell>{pct(r.metrics?.search?.by_split?.["search:holdout"]?.p_at_3)}</TableCell>
                  <TableCell>${Number(r.cost_used_usd || 0).toFixed(2)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {latest?.metrics?.search?.by_query_type && (
          <div>
            <div className="text-sm font-medium mb-2">By query type — {latest.label}</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Queries</TableHead>
                  <TableHead>Top-3 precision</TableHead>
                  <TableHead>Top-1 off topic</TableHead>
                  <TableHead>Empty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(latest.metrics.search.by_query_type)
                  .filter(([k]) => k !== "_rec")
                  .sort((a, b) => b[1].queries - a[1].queries)
                  .map(([k, a]) => (
                    <TableRow key={k}>
                      <TableCell>{k}</TableCell>
                      <TableCell>{a.queries}</TableCell>
                      <TableCell>{pct(a.p_at_3)}</TableCell>
                      <TableCell>{pct(a.top1_off_topic_rate)}</TableCell>
                      <TableCell>{pct(a.empty_rate)}</TableCell>
                    </TableRow>
                  ))}
                {Object.entries(latest.metrics.recommendation || {})
                  .filter(([k]) => k !== "_search")
                  .map(([k, a]) => (
                    <TableRow key={k}>
                      <TableCell>recommendation: {k}</TableCell>
                      <TableCell>{a.queries}</TableCell>
                      <TableCell>{pct(a.p_at_3)}</TableCell>
                      <TableCell>{pct(a.top1_off_topic_rate)}</TableCell>
                      <TableCell>{pct(a.empty_rate)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
            {latest.metrics.judge_calibration && (
              <p className="text-xs text-muted-foreground mt-2">
                Judge agreement with the stronger model: {pct(latest.metrics.judge_calibration.relevant_binary)} on relevant / not relevant.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
