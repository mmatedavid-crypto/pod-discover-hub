import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { setSeo } from "@/lib/seo";
import { toast } from "@/hooks/use-toast";
import { useAdminAccess } from "@/hooks/useAdminAccess";

type Status = {
  controls: any;
  spend: { day: string; spend_usd: number; calls: number };
  jobs: Record<string, number>;
  scope: { min_rank: number; podcasts_in_scope: number; podcasts_done: number };
  avg_cost_per_job_usd: number;
  jobs_possible_today: number;
};

async function call(action: string, body?: any) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/seo-enrich-admin?action=${action}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

export default function AdminAiEnrichmentPage() {
  const { loading: adminLoading, isAdmin } = useAdminAccess();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSeo({ title: "AI Enrichment | Admin | Podiverzum", description: "SEO + AI enrichment controls", noindex: true }); }, []);

  const refresh = async () => {
    if (!isAdmin) return;
    setLoading(true);
    const r = await call("status");
    setStatus(r);
    setLoading(false);
  };

  useEffect(() => {
    if (adminLoading || !isAdmin) return;
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [adminLoading, isAdmin]);

  const setControls = async (patch: any) => {
    setBusy(true);
    const r = await call("set_controls", patch);
    if (r.error) toast({ title: "Error", description: r.error, variant: "destructive" });
    else toast({ title: "Saved" });
    await refresh();
    setBusy(false);
  };

  const expandScope = async (min_rank: number) => {
    setBusy(true);
    const r = await call("expand_scope", { min_rank });
    if (r.error) toast({ title: "Error", description: r.error, variant: "destructive" });
    else toast({ title: `Scope set to rank ≥ ${min_rank}` });
    await refresh();
    setBusy(false);
  };

  const triggerEnqueue = async () => {
    setBusy(true);
    const r = await call("enqueue", {});
    toast({ title: "Enqueue", description: JSON.stringify(r) });
    await refresh();
    setBusy(false);
  };

  const triggerRun = async () => {
    setBusy(true);
    const r = await call("run", { batch: 20 });
    toast({ title: "Run", description: JSON.stringify(r) });
    await refresh();
    setBusy(false);
  };

  if (adminLoading) return <Layout><div className="container mx-auto py-10">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-10">Nincs jogosultság.</div></Layout>;
  if (loading || !status) return <Layout><div className="container mx-auto py-10">Loading…</div></Layout>;

  const c = status.controls || {};
  const enabled = c.enabled !== false;
  const budget = Number(c.daily_budget_usd ?? 1);
  const spend = Number(status.spend?.spend_usd || 0);
  const pct = Math.min(100, (spend / Math.max(0.0001, budget)) * 100);
  const eta = status.scope.podcasts_in_scope > 0
    ? `${status.scope.podcasts_done}/${status.scope.podcasts_in_scope} podcasts done in current scope`
    : "—";

  return (
    <Layout>
      <div className="container mx-auto py-10 max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold">AI Enrichment</h1>
        <p className="text-sm text-muted-foreground">
          SEO meta + ai_summary generation. Async only. No AI in the RSS crawler. Auto-pauses at the daily budget.
        </p>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
              <div className={`text-lg font-medium ${enabled ? "text-emerald-500" : "text-amber-500"}`}>
                {enabled ? "Running" : `Paused${c.auto_paused_reason ? ` (${c.auto_paused_reason})` : ""}`}
              </div>
            </div>
            <Button onClick={() => setControls({ enabled: !enabled })} disabled={busy} variant={enabled ? "secondary" : "default"}>
              {enabled ? "Pause" : "Resume"}
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Daily spend ({status.spend?.day})</div>
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-semibold">${spend.toFixed(4)}</div>
            <div className="text-sm text-muted-foreground">/ ${budget.toFixed(2)} cap · {status.spend?.calls || 0} calls</div>
          </div>
          <div className="h-2 mt-2 bg-secondary rounded">
            <div className="h-2 bg-primary rounded" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex gap-2 mt-3 text-sm">
            {[1, 5, 10, 25, 50].map((b) => (
              <Button key={b} size="sm" variant={budget === b ? "default" : "secondary"} disabled={busy} onClick={() => setControls({ daily_budget_usd: b })}>
                ${b}
              </Button>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Jobs</div>
          <div className="grid grid-cols-4 gap-3">
            {(["pending","processing","done","failed"] as const).map((s) => (
              <div key={s}>
                <div className="text-xs text-muted-foreground capitalize">{s}</div>
                <div className="text-xl font-medium">{status.jobs?.[s] ?? 0}</div>
              </div>
            ))}
          </div>
          <div className="text-xs text-muted-foreground mt-3">
            Avg ${status.avg_cost_per_job_usd.toFixed(5)}/job · ~{status.jobs_possible_today} more possible today within budget
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" variant="secondary" onClick={triggerEnqueue} disabled={busy}>Enqueue now</Button>
            <Button size="sm" variant="secondary" onClick={triggerRun} disabled={busy}>Run batch</Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Scope</div>
          <div className="text-sm">Current: <span className="font-medium">rank ≥ {status.scope.min_rank}</span> · {eta}</div>
          <div className="flex gap-2 mt-3">
            {[8, 6, 4, 1].map((r) => (
              <Button key={r} size="sm" variant={status.scope.min_rank === r ? "default" : "secondary"} disabled={busy} onClick={() => expandScope(r)}>
                rank ≥ {r}
              </Button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Bulk rollout order: 8 → 6 → 4 → all. Expand only after sampling output quality.
          </div>
        </section>

        <Button variant="outline" onClick={refresh} disabled={busy}>Refresh</Button>
      </div>
    </Layout>
  );
}
