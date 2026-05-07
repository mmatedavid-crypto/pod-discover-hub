import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { useNoindex } from "@/lib/useNoindex";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, Activity, AlertTriangle, CheckCircle2, Clock, PlayCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

type OpsData = any;

type Tone = "ok" | "warn" | "danger" | "muted";

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const cls =
    tone === "ok" ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
    : tone === "warn" ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
    : tone === "danger" ? "bg-destructive/15 text-destructive border-destructive/30"
    : "bg-secondary text-muted-foreground border-border";
  return <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${cls}`}>{children}</span>;
}

function Stat({ label, value, tone = "muted", sub }: { label: string; value: any; tone?: Tone; sub?: string }) {
  const valueCls =
    tone === "danger" ? "text-destructive"
    : tone === "warn" ? "text-amber-500"
    : tone === "ok" ? "text-emerald-500"
    : "text-foreground";
  return (
    <div className="p-3 rounded-lg border border-border bg-card">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${valueCls}`}>{value ?? "—"}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function num(n: any): number { return typeof n === "number" ? n : 0; }
function fmt(n: any): string { return n == null ? "—" : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AdminOpsPage() {
  useNoindex("Ops Dashboard — Admin");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [data, setData] = useState<OpsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: uid, _role: "admin" });
      const admin = hasAdmin === true || uid === TEMP_ADMIN_USER_ID;
      setIsAdmin(admin);
      setReady(true);
    })();
  }, [nav]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res, error } = await (supabase as any).rpc("get_ops_dashboard_status");
      if (error) throw error;
      setData(res);
    } catch (e: any) {
      toast({ title: "Failed to load ops status", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const invoke = async (name: string, body: any = {}, label?: string) => {
    setBusy(name);
    try {
      const { data: res, error } = await supabase.functions.invoke(name, { body });
      if (error) throw error;
      toast({ title: `${label || name} ✓`, description: typeof res === "object" ? JSON.stringify(res).slice(0, 180) : String(res) });
      load();
    } catch (e: any) {
      toast({ title: `${label || name} failed`, description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const reapAi = async () => {
    setBusy("reap_ai");
    try {
      const { data: r, error } = await (supabase as any).rpc("reap_ai_stale_locks", { _older_than_minutes: 5 });
      if (error) throw error;
      toast({ title: "AI stale locks reaped", description: `Released ${r ?? 0}` });
      load();
    } catch (e: any) {
      toast({ title: "Reaper failed", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const reapDh = async () => {
    setBusy("reap_dh");
    try {
      const { data: r, error } = await (supabase as any).rpc("reap_deep_hydration_stale", { _older_than_minutes: 30 });
      if (error) throw error;
      toast({ title: "Deep hydration stale reaped", description: `Released ${r ?? 0}` });
      load();
    } catch (e: any) {
      toast({ title: "Reaper failed", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Not authorized</div></Layout>;

  const d = data || {};
  const sum = d.summary || {};
  const dh = d.deep_hydration || {};
  const ai = d.ai_enrichment || {};
  const emb = d.embeddings || {};
  const embProg = emb.progress || {};
  const ref = d.incremental_refresh || {};
  const hunt = d.rss_hunter || {};
  const stage = d.staging_discovery || {};
  const title = d.title_cleanup || {};
  const cron: any[] = Array.isArray(d.cron) ? d.cron : [];

  const aiBudget = num(ai?.controls?.daily_budget_usd) || 5;
  const aiSpend = num(ai?.spend_today);
  const aiPct = aiBudget > 0 ? (aiSpend / aiBudget) * 100 : 0;

  // Alerts
  const alerts: { tone: Tone; msg: string }[] = [];
  if (num(ai.stale_locks) > 100) alerts.push({ tone: "danger", msg: `AI stale locks: ${ai.stale_locks}` });
  if (num(dh.stale_in_progress) > 0) alerts.push({ tone: "warn", msg: `Deep hydration stale in_progress: ${dh.stale_in_progress}` });
  if (num(ref.failed_feeds) > 50) alerts.push({ tone: "warn", msg: `Failed feeds: ${ref.failed_feeds}` });
  if (num(ref.due_count) > 1000) alerts.push({ tone: "warn", msg: `Refresh due > 1000: ${ref.due_count}` });
  if (aiPct > 80) alerts.push({ tone: "warn", msg: `AI spend at ${aiPct.toFixed(0)}% of $${aiBudget} daily budget` });
  if (num(emb.pending_tiered) > 0 && num(embProg.embedded_last_run) === 0) {
    alerts.push({ tone: "warn", msg: `Embedding pending=${emb.pending_tiered} but last run embedded 0` });
  }
  const recompute = cron.find((c) => c.jobname?.includes("recompute-ranks"));
  if (recompute?.active) alerts.push({ tone: "danger", msg: "Legacy recompute-ranks cron is ACTIVE" });
  const dailyGrowth = cron.find((c) => c.jobname?.includes("growth-04utc") || c.jobname?.includes("growth-16utc"));
  if (dailyGrowth?.active) alerts.push({ tone: "danger", msg: "Legacy daily-growth-run cron is ACTIVE" });
  if (num(stage.growth_timed_out_24h) > 0) alerts.push({ tone: "warn", msg: `Growth runs timed out 24h: ${stage.growth_timed_out_24h}` });

  const tierDist = sum.tier_dist || {};
  const shadowDist = sum.shadow_tier_dist || {};

  return (
    <Layout>
      <div className="container mx-auto py-6 sm:py-8 space-y-6 max-w-6xl px-3">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold flex items-center gap-2">
              <Activity className="h-6 w-6 text-brand" /> Ops Dashboard
            </h1>
            <p className="text-xs text-muted-foreground">
              Generated: {timeAgo(d.generated_at)} · Read-only system overview + safe maintenance controls.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </header>

        {/* Alerts */}
        {alerts.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Alerts</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <Badge tone={a.tone}>{a.tone}</Badge>
                  <span>{a.msg}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Summary cards */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Stat label="Podcasts" value={fmt(sum.total_podcasts)} />
          <Stat label="Episodes" value={fmt(sum.total_episodes)} />
          <Stat label="Failed feeds" value={fmt(sum.failed_feeds)} tone={num(sum.failed_feeds) > 50 ? "warn" : "muted"} />
          <Stat label="Quarantined" value={fmt(sum.quarantined)} />
          <Stat label="Manual review" value={fmt(sum.manual_review)} tone={num(sum.manual_review) > 0 ? "warn" : "muted"} />
          <Stat label="AI pending" value={fmt(sum.ai_pending)} tone={num(sum.ai_pending) > 10000 ? "warn" : "muted"} />
          <Stat label="AI spend today" value={`$${aiSpend.toFixed(2)}`} sub={`of $${aiBudget}`} tone={aiPct > 80 ? "warn" : "muted"} />
          <Stat label="DH pending" value={fmt(sum.dh_pending)} />
          <Stat label="Embed pending" value={fmt(sum.embed_pending)} />
          <Stat label="Staging unprocessed" value={fmt(sum.staging_unprocessed)} />
          <Stat label="Discovery pending" value={fmt(sum.discovery_pending)} />
          <Stat label="Tier S/A/B/C/D/E" value={["S","A","B","C","D","E"].map((t)=>num(tierDist[t])).join("/")} />
        </section>

        {/* Shadow tier distribution */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Shadow tier distribution</CardTitle></CardHeader>
          <CardContent className="text-sm flex flex-wrap gap-3">
            {["S","A","B","C","D","E","unranked"].map((t) => (
              <div key={t} className="flex items-center gap-1">
                <Badge tone={t==="S"?"ok":t==="A"?"ok":t==="B"?"muted":"muted"}>{t}</Badge>
                <span className="font-mono text-xs">{fmt(shadowDist[t])}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Deep hydration */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm">Deep Hydration</CardTitle>
            <div className="flex items-center gap-2">
              {num(dh.stale_in_progress) > 0 ? <Badge tone="warn">stale {dh.stale_in_progress}</Badge> : <Badge tone="ok">healthy</Badge>}
              <Button size="sm" variant="outline" onClick={reapDh} disabled={busy==="reap_dh"}>Reap stale</Button>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <Stat label="Pending S" value={fmt(dh.pending_S)} />
            <Stat label="Pending A" value={fmt(dh.pending_A)} />
            <Stat label="Pending B" value={fmt(dh.pending_B)} />
            <Stat label="Pending C" value={fmt(dh.pending_C)} />
            <Stat label="In progress" value={fmt(dh.in_progress)} />
            <Stat label="Failed" value={fmt(dh.failed)} tone={num(dh.failed)>0?"warn":"muted"} />
            <Stat label="Eps 15m" value={fmt(dh.episodes_15m)} />
            <Stat label="Eps 1h" value={fmt(dh.episodes_1h)} />
            <Stat label="Eps 24h" value={fmt(dh.episodes_24h)} />
            <Stat label="Last run" value={timeAgo(dh.last_run?.finished_at)} sub={`${num(dh.last_run?.new_episodes)} new`} />
          </CardContent>
        </Card>

        {/* AI enrichment */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm">AI Enrichment</CardTitle>
            <div className="flex items-center gap-2">
              {num(ai.stale_locks) > 100 ? <Badge tone="danger">stale {ai.stale_locks}</Badge>
                : num(ai.stale_locks) > 0 ? <Badge tone="warn">stale {ai.stale_locks}</Badge>
                : <Badge tone="ok">healthy</Badge>}
              <Button size="sm" variant="outline" onClick={reapAi} disabled={busy==="reap_ai"}>Reap stale locks</Button>
              <Button size="sm" variant="outline" onClick={() => invoke("seo-enrich-enqueue", { trigger: "ops" }, "Enqueue SEO")} disabled={busy==="seo-enrich-enqueue"}>
                <PlayCircle className="h-3 w-3" /> Enqueue
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <Stat label="Pend S" value={fmt(ai.pending_S)} />
            <Stat label="Pend A" value={fmt(ai.pending_A)} />
            <Stat label="Pend B" value={fmt(ai.pending_B)} />
            <Stat label="Pend C" value={fmt(ai.pending_C)} />
            <Stat label="Pend other" value={fmt(ai.pending_other)} />
            <Stat label="Processing" value={fmt(ai.processing)} />
            <Stat label="Done 15m" value={fmt(ai.done_15m)} tone="ok" />
            <Stat label="Done 1h" value={fmt(ai.done_1h)} tone="ok" />
            <Stat label="Done 24h" value={fmt(ai.done_24h)} />
            <Stat label="Failed 1h" value={fmt(ai.failed_1h)} tone={num(ai.failed_1h)>0?"warn":"muted"} />
            <Stat label="Spend today" value={`$${aiSpend.toFixed(2)}`} sub={`${aiPct.toFixed(0)}% of $${aiBudget}`} tone={aiPct>80?"warn":"muted"} />
            <Stat label="Stale locks" value={fmt(ai.stale_locks)} tone={num(ai.stale_locks)>100?"danger":num(ai.stale_locks)>0?"warn":"muted"} />
          </CardContent>
        </Card>

        {/* Embeddings */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm">Podcast Embeddings</CardTitle>
            <div className="flex items-center gap-2">
              {num(emb.pending_tiered) > 0 && num(embProg.embedded_last_run) === 0 ? <Badge tone="warn">no progress</Badge> : <Badge tone="ok">running</Badge>}
              <Button size="sm" variant="outline" onClick={() => invoke("embed-podcast-runner", { trigger: "ops" }, "Embed runner")} disabled={busy==="embed-podcast-runner"}>
                <PlayCircle className="h-3 w-3" /> Run once
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <Stat label="Embedded total" value={fmt(emb.embedded_total)} />
            <Stat label="Pending S/A/B/C" value={fmt(emb.pending_tiered)} />
            <Stat label="Last run embedded" value={fmt(embProg.embedded_last_run)} />
            <Stat label="Cache hits last" value={fmt(embProg.cache_hits_last_run)} />
            <Stat label="Errors last" value={fmt(embProg.errors_last_run)} tone={num(embProg.errors_last_run)>0?"warn":"muted"} />
            <Stat label="Eff/hour" value={fmt(embProg.effective_per_hour)} />
            <Stat label="Cron" value={embProg.cron_schedule || "—"} />
            <Stat label="Recommended" value={embProg.recommended_schedule || "—"} />
            <Stat label="Last run" value={timeAgo(embProg.last_run_at)} sub={`${num(embProg.duration_ms)}ms`} />
            <Stat label="ETA min" value={fmt(embProg.eta_minutes)} />
          </CardContent>
        </Card>

        {/* Refresh */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm">Incremental Refresh</CardTitle>
            <Badge tone={num(ref.due_count)>1000?"warn":"ok"}>{num(ref.due_count)>1000?"backlog":"healthy"}</Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <Stat label="Due" value={fmt(ref.due_count)} tone={num(ref.due_count)>1000?"warn":"muted"} />
            <Stat label="Failed feeds" value={fmt(ref.failed_feeds)} />
            <Stat label="Under backoff" value={fmt(ref.under_backoff)} />
            <Stat label="Fetched 15m" value={fmt(ref.fetched_15m)} />
            <Stat label="Fetched 1h" value={fmt(ref.fetched_1h)} />
            <Stat label="Last run" value={timeAgo(ref.last_run?.finished_at)} sub={`${num(ref.last_run?.refreshed)} refreshed, ${num(ref.last_run?.failed)} failed`} />
          </CardContent>
        </Card>

        {/* Hunter */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm">RSS Hunter / Self-Healing</CardTitle>
            <div className="flex items-center gap-2">
              <Badge tone={num(hunt.manual_review)>0?"warn":"ok"}>{num(hunt.manual_review)>0?`${hunt.manual_review} manual`:"healthy"}</Badge>
              <Button size="sm" variant="outline" onClick={() => invoke("rss-hunter", { trigger: "ops" }, "RSS hunter")} disabled={busy==="rss-hunter"}>
                <PlayCircle className="h-3 w-3" /> Run once
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <Stat label="Due" value={fmt(hunt.due_count)} />
            <Stat label="Manual review" value={fmt(hunt.manual_review)} tone={num(hunt.manual_review)>0?"warn":"muted"} />
            <Stat label="Not found" value={fmt(hunt.not_found)} />
            <Stat label="Recovered 24h" value={fmt(hunt.recovered_recent)} tone="ok" />
            <Stat label="Last run" value={timeAgo(hunt.last_run?.finished_at)} sub={`+${num(hunt.last_run?.recovered)} rec`} />
          </CardContent>
        </Card>

        {/* Staging / Discovery */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm">Staging / Discovery / Growth</CardTitle>
            <Badge tone={num(stage.growth_timed_out_24h)>0?"warn":"ok"}>{num(stage.growth_timed_out_24h)>0?`${stage.growth_timed_out_24h} timed out`:"healthy"}</Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <Stat label="Staging unprocessed" value={fmt(stage.staging_unprocessed)} />
            <Stat label="Staging backoff" value={fmt(stage.staging_backoff)} />
            <Stat label="Discovery pending" value={fmt(stage.discovery_pending)} />
            <Stat label="Discovery backoff" value={fmt(stage.discovery_backoff)} />
            <Stat label="Autopilot last" value={timeAgo(stage.growth_autopilot?.last_tick_at)} sub={stage.growth_autopilot?.state || "—"} />
            <Stat label="Growth timed_out 24h" value={fmt(stage.growth_timed_out_24h)} tone={num(stage.growth_timed_out_24h)>0?"warn":"muted"} />
          </CardContent>
        </Card>

        {/* Title cleanup */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Title Cleanup</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Pending podcasts" value={fmt(title.pending_podcasts)} />
            <Stat label="Pending episodes" value={fmt(title.pending_episodes)} />
            <Stat label="Last cleaned" value={fmt(num(title.last_run?.episodes?.cleaned) + num(title.last_run?.podcasts?.cleaned))} />
            <Stat label="Last run" value={timeAgo(title.last_run?.finished_at)} sub={title.last_run?.applied_schedule || "—"} />
          </CardContent>
        </Card>

        {/* Cron inventory */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" /> Cron jobs</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left border-b border-border">
                    <th className="py-1.5 pr-2">#</th>
                    <th className="py-1.5 pr-2">Name</th>
                    <th className="py-1.5 pr-2">Schedule</th>
                    <th className="py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cron.map((c) => {
                    const isLegacy = c.jobname?.includes("recompute-ranks") || c.jobname?.includes("growth-04utc") || c.jobname?.includes("growth-16utc");
                    return (
                      <tr key={c.jobid} className="border-b border-border/50">
                        <td className="py-1.5 pr-2 font-mono">{c.jobid}</td>
                        <td className="py-1.5 pr-2">{c.jobname}</td>
                        <td className="py-1.5 pr-2 font-mono">{c.schedule}</td>
                        <td className="py-1.5">
                          {c.active
                            ? (isLegacy ? <Badge tone="danger">legacy ACTIVE</Badge> : <Badge tone="ok"><CheckCircle2 className="h-3 w-3 inline" /> active</Badge>)
                            : <Badge tone="muted">disabled</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
