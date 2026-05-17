import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useNoindex } from "@/lib/useNoindex";
import { toast } from "@/hooks/use-toast";

const FN_URL = (name: string) => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;

async function callFn(name: string, body: any) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const r = await fetch(FN_URL(name), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return r.json();
}

type Row = {
  podcast_id: string;
  title: string;
  slug: string;
  rank_label: string | null;
  episode_count: number;
  pi_backfill_episode_count: number | null;
  pi_gap: number;
  pass_status: "rss_pending" | "pi_pending" | "complete";
  pi_backfill_approved: boolean | null;
  full_backfill_completed_at: string | null;
  pi_backfill_completed_at: string | null;
};

type Controls = {
  enabled: boolean;
  cron_enabled?: boolean;
  max_podcasts_per_run: number;
  max_new_episodes_per_run: number;
  max_runtime_seconds: number;
  tier_filter: string[];
  dry_run: boolean;
  force_refresh: boolean;
  per_domain_min_ms: number;
  pause_if_enrichment_backlog_above?: number;
  pause_if_embedding_backlog_above?: number;
  pause_if_error_rate_above?: number;
  expand_to_b_tier_after_successful_runs?: number;
  successful_scheduled_run_count?: number;
};

type RunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  trigger_source: string;
  tier_filter: string[];
  podcasts_processed: number;
  new_episodes_inserted: number;
  duplicates_skipped: number;
  failed_feeds: number;
  skipped_reason: string | null;
  runtime_ms: number | null;
  ai_backlog_before: number | null;
  ai_backlog_after: number | null;
  embedding_backlog_before: number | null;
  embedding_backlog_after: number | null;
  error_message: string | null;
};

const TIERS = ["S","A","B","C"] as const;

export default function AdminArchiveBackfillPage() {
  useNoindex("HU Archive Backfill — Admin");
  const [controls, setControls] = useState<Controls | null>(null);
  const [lastRun, setLastRun] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [topRows, setTopRows] = useState<Row[]>([]);
  const [recentRuns, setRecentRuns] = useState<RunRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [ctrlRes, lastRes, view, runsRes] = await Promise.all([
      supabase.from("app_settings").select("value").eq("key", "hu_deep_archive_controls").maybeSingle(),
      supabase.from("app_settings").select("value").eq("key", "hu_deep_archive_last_run").maybeSingle(),
      (supabase as any).from("v_hu_archive_completeness")
        .select("podcast_id,title,slug,rank_label,episode_count,pi_backfill_episode_count,pi_gap,pass_status,pi_backfill_approved,full_backfill_completed_at,pi_backfill_completed_at"),
      (supabase as any).from("hu_archive_backfill_runs")
        .select("*").order("started_at", { ascending: false }).limit(20),
    ]);
    setControls((ctrlRes.data?.value as any) || null);
    setLastRun(lastRes.data?.value || null);
    setRecentRuns((runsRes.data as RunRow[]) || []);
    const all: Row[] = (view.data as any[]) || [];

    const totals = all.reduce((acc: any, r) => {
      acc.podcasts++;
      acc.episodes += r.episode_count || 0;
      if (r.pass_status === "rss_pending") acc.rss_pending++;
      if (r.pass_status === "pi_pending") acc.pi_pending++;
      if (r.pass_status === "complete") acc.complete++;
      const t = r.rank_label || "?";
      acc.byTier[t] = (acc.byTier[t] || 0) + 1;
      return acc;
    }, { podcasts: 0, episodes: 0, rss_pending: 0, pi_pending: 0, complete: 0, byTier: {} as Record<string, number> });

    setStats(totals);
    setTopRows([...all].sort((a, b) => (b.pi_gap || 0) - (a.pi_gap || 0)).slice(0, 30));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const saveControls = async (patch: Partial<Controls>) => {
    const next = { ...(controls || {} as any), ...patch };
    setControls(next);
    await supabase.from("app_settings").upsert({
      key: "hu_deep_archive_controls", value: next as any, updated_at: new Date().toISOString(),
    });
    toast({ title: "Saved" });
  };

  const runDry = async () => {
    setBusy(true);
    const r = await callFn("hungarian-deep-archive-backfill", { dry_run: true });
    setBusy(false);
    setLastRun(r);
    toast({ title: r.ok ? "Dry audit done" : "Dry audit failed", description: r.ok ? `${r.processed_podcasts || 0} pods, ${r.new_episodes || 0} new (sim)` : r.error });
    load();
  };
  const runBatch = async () => {
    setBusy(true);
    const r = await callFn("hungarian-deep-archive-backfill", { dry_run: false });
    setBusy(false);
    setLastRun(r);
    toast({ title: r.ok ? "Batch finished" : "Batch failed", description: r.ok ? `${r.processed_podcasts || 0} pods, ${r.new_episodes || 0} new ep.` : r.error });
    load();
  };
  const togglePause = async () => saveControls({ enabled: !(controls?.enabled !== false) });
  const approvePi = async (id: string) => {
    await (supabase as any).from("podcasts").update({ pi_backfill_approved: true }).eq("id", id);
    toast({ title: "Approved for PI" });
    load();
  };

  if (loading || !controls) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto py-8 max-w-6xl space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">HU Archive Backfill</h1>
          <p className="text-xs text-muted-foreground">Deep archive ingestion for Hungarian-approved podcasts (RSS exhaustion + PodcastIndex sweep).</p>
        </header>

        <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          <Stat label="HU podcasts" v={stats?.podcasts} />
          <Stat label="HU episodes" v={stats?.episodes} />
          <Stat label="RSS pending" v={stats?.rss_pending} tone={stats?.rss_pending ? "warn" : "default"} />
          <Stat label="PI pending" v={stats?.pi_pending} tone={stats?.pi_pending ? "warn" : "default"} />
          <Stat label="Complete" v={stats?.complete} />
          <Stat label="S/A/B/C" v={TIERS.map((t) => `${t}:${stats?.byTier?.[t] || 0}`).join(" ")} small />
        </section>

        <section className="rounded-lg border border-border bg-card p-4 space-y-4">
          <h2 className="font-semibold">Controls</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Max podcasts / run">
              <Input type="number" value={controls.max_podcasts_per_run} onChange={(e) => saveControls({ max_podcasts_per_run: Number(e.target.value) })} />
            </Field>
            <Field label="Max new episodes / run">
              <Input type="number" value={controls.max_new_episodes_per_run} onChange={(e) => saveControls({ max_new_episodes_per_run: Number(e.target.value) })} />
            </Field>
            <Field label="Max runtime (s)">
              <Input type="number" value={controls.max_runtime_seconds} onChange={(e) => saveControls({ max_runtime_seconds: Number(e.target.value) })} />
            </Field>
            <Field label="Per-domain throttle (ms)">
              <Input type="number" value={controls.per_domain_min_ms} onChange={(e) => saveControls({ per_domain_min_ms: Number(e.target.value) })} />
            </Field>
            <Field label="Tier filter">
              <div className="flex gap-3 items-center pt-2">
                {TIERS.map((t) => (
                  <label key={t} className="flex items-center gap-1 text-sm">
                    <Checkbox checked={controls.tier_filter.includes(t)} onCheckedChange={(c) => {
                      const next = c ? Array.from(new Set([...controls.tier_filter, t])) : controls.tier_filter.filter((x) => x !== t);
                      saveControls({ tier_filter: next });
                    }} />
                    {t}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Flags">
              <div className="flex gap-3 items-center pt-2">
                <label className="flex items-center gap-1 text-sm">
                  <Checkbox checked={controls.force_refresh} onCheckedChange={(c) => saveControls({ force_refresh: !!c })} /> force_refresh
                </label>
              </div>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            <Button onClick={runDry} disabled={busy}>Run dry audit</Button>
            <Button onClick={runBatch} disabled={busy || controls.enabled === false} variant="default">Run backfill batch</Button>
            <Button onClick={togglePause} variant="outline">{controls.enabled === false ? "Resume" : "Pause"}</Button>
            <Button onClick={() => saveControls({ cron_enabled: !(controls.cron_enabled !== false) })} variant="outline">
              {controls.cron_enabled === false ? "Enable cron" : "Pause cron"}
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4 space-y-2">
          <h2 className="font-semibold">Automation</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <Stat label="Cron" v={controls.cron_enabled === false ? "off" : "on"} tone={controls.cron_enabled === false ? "warn" : "default"} small />
            <Stat label="Schedule" v="37 */6 * * *" small />
            <Stat label="Active tiers" v={(controls.tier_filter || []).join("/")} small />
            <Stat label="✓ scheduled runs" v={controls.successful_scheduled_run_count ?? 0} />
            <Stat label="B-tier auto" v={(controls.successful_scheduled_run_count ?? 0) >= (controls.expand_to_b_tier_after_successful_runs ?? 3) ? "yes" : "no"} small />
            <Stat label="AI backlog cap" v={controls.pause_if_enrichment_backlog_above ?? "—"} small />
          </div>
          <p className="text-xs text-muted-foreground">
            Cron: <code>podiverzum-hu-deep-archive-6h</code> (jobid 28). After {controls.expand_to_b_tier_after_successful_runs ?? 3} successful runs, B-tier is added automatically. Skips when AI backlog &gt; {controls.pause_if_enrichment_backlog_above ?? 50000}, embedding backlog &gt; {controls.pause_if_embedding_backlog_above ?? 50000}, or recent error rate &gt; {Math.round((controls.pause_if_error_rate_above ?? 0.2) * 100)}%.
          </p>
        </section>

        {lastRun && (
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold mb-2">Last run</h2>
            <div className="text-xs text-muted-foreground mb-2">{lastRun.finished_at} {lastRun.dry_run ? "(dry)" : ""}</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <Stat label="Processed" v={lastRun.processed_podcasts} />
              <Stat label="New ep." v={lastRun.new_episodes} />
              <Stat label="Duplicates" v={lastRun.duplicates} />
              <Stat label="Failed" v={lastRun.failed} tone={lastRun.failed ? "warn" : "default"} />
              <Stat label="RSS pending" v={lastRun.remaining_rss_pending} />
              <Stat label="PI pending" v={lastRun.remaining_pi_pending} />
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Per-podcast details</summary>
              <pre className="mt-2 overflow-auto max-h-96 bg-secondary p-2 rounded">{JSON.stringify(lastRun.per_podcast, null, 2)}</pre>
            </details>
          </section>
        )}

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-semibold mb-2">Top 30 potential gains (PI gap)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">Title</th><th>Tier</th><th>In DB</th><th>PI count</th><th>Gap</th><th>Status</th><th>PI approved</th><th></th>
                </tr>
              </thead>
              <tbody>
                {topRows.map((r) => (
                  <tr key={r.podcast_id} className="border-t border-border">
                    <td className="py-1 pr-2 truncate max-w-[280px]">{r.title}</td>
                    <td>{r.rank_label || "—"}</td>
                    <td>{r.episode_count}</td>
                    <td>{r.pi_backfill_episode_count ?? "—"}</td>
                    <td className="font-medium">{r.pi_gap}</td>
                    <td>{r.pass_status}</td>
                    <td>{r.pi_backfill_approved ? "✓" : "—"}</td>
                    <td>
                      {!r.pi_backfill_approved && (r.rank_label === "B" || r.rank_label === "C") && (
                        <Button size="sm" variant="outline" onClick={() => approvePi(r.podcast_id)}>Approve PI</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-semibold mb-2">Recent runs (last 20)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">Started</th><th>Trigger</th><th>Status</th><th>Tiers</th>
                  <th>Pods</th><th>New ep.</th><th>Dup</th><th>Failed</th><th>AI bl.</th><th>Skip / err</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-1 pr-2">{new Date(r.started_at).toLocaleString()}</td>
                    <td>{r.trigger_source}</td>
                    <td className={r.status === "failed" ? "text-destructive" : r.status === "skipped" ? "text-brand" : ""}>{r.status}</td>
                    <td>{(r.tier_filter || []).join("/")}</td>
                    <td>{r.podcasts_processed}</td>
                    <td className="font-medium">{r.new_episodes_inserted}</td>
                    <td>{r.duplicates_skipped}</td>
                    <td>{r.failed_feeds}</td>
                    <td>{r.ai_backlog_before ?? "—"} → {r.ai_backlog_after ?? "—"}</td>
                    <td className="truncate max-w-[220px] text-muted-foreground">{r.skipped_reason || r.error_message || ""}</td>
                  </tr>
                ))}
                {recentRuns.length === 0 && (
                  <tr><td colSpan={10} className="text-muted-foreground py-4 text-center">No runs yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Layout>
  );
}

function Stat({ label, v, tone = "default", small = false }: { label: string; v: any; tone?: "default" | "warn"; small?: boolean }) {
  return (
    <div className="p-3 rounded-lg border border-border bg-card">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`${small ? "text-xs" : "text-xl"} font-semibold mt-1 ${tone === "warn" ? "text-brand" : ""}`}>{v ?? "—"}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}
