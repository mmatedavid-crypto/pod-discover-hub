import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useNoindex } from "@/lib/useNoindex";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

const DEFAULT_SETTINGS = {
  autonomous_growth_enabled: false,
  auto_add_enabled: false,
  approval_queue_enabled: true,
  min_rank_for_auto_add: 8,
  max_auto_add_per_run: 20,
  max_discovery_per_run: 50,
  max_ai_summaries_per_day: 200,
  discovery_categories: ["technology", "business", "science", "news", "education"],
  language: "en",
  max_episode_age_days: 90,
};

export default function AdminGrowthPage() {
  useNoindex("Admin · Growth — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [settings, setSettings] = useState<any>(DEFAULT_SETTINGS);
  const [catsInput, setCatsInput] = useState("");
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<any>(null);
  const [stats, setStats] = useState<any>({
    refreshedToday: 0, autoAddedToday: 0, queueCount: 0, failedFeeds: 0, avgRank: 0,
  });
  const [dumpRuns, setDumpRuns] = useState<any[]>([]);
  const [processingDump, setProcessingDump] = useState(false);
  const [recentIngesting, setRecentIngesting] = useState(false);
  const [pasteUrls, setPasteUrls] = useState("");
  const [pasteOpml, setPasteOpml] = useState("");
  const [pasteSubmitting, setPasteSubmitting] = useState(false);
  const [foundationRunning, setFoundationRunning] = useState(false);
  const [foundationContinue, setFoundationContinue] = useState(false);
  const [foundation, setFoundation] = useState<any>(null);
  const [unprocessed, setUnprocessed] = useState(0);
  const [hydrating, setHydrating] = useState(false);
  const [hydrationLimit, setHydrationLimit] = useState(5);
  const [hydration, setHydration] = useState<any>(null);
  const [hydrationCounts, setHydrationCounts] = useState({ not_started: 0, in_progress: 0, completed: 0, failed: 0, eligible: 0 });
  const [lastHydrateResult, setLastHydrateResult] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { nav("/auth"); return; }
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      const isAdmin = (roles || []).some((r: any) => r.role === "admin");
      setAllowed(isAdmin || user.id === TEMP_ADMIN_USER_ID);
      setReady(true);
      await loadAll();
    })();
  }, []);

  const loadAll = async () => {
    const { data: row } = await supabase.from("app_settings").select("value").eq("key", "growth").maybeSingle();
    const s = { ...DEFAULT_SETTINGS, ...((row?.value as any) || {}) };
    setSettings(s);
    setCatsInput((s.discovery_categories || []).join(", "));

    const { data: runs } = await supabase.from("growth_runs").select("*").order("started_at", { ascending: false }).limit(1);
    setLastRun(runs?.[0] || null);

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [pods, autoAdd, queue, failed, rankAvg] = await Promise.all([
      supabase.from("podcasts").select("id, last_fetched_at").gte("last_fetched_at", since),
      supabase.from("podcasts").select("id").eq("source", "discovery_auto").gte("created_at", since),
      supabase.from("discovery_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("podcasts").select("id", { count: "exact", head: true }).eq("rss_status", "failed"),
      supabase.from("podcasts").select("podiverzum_rank"),
    ]);
    const ranks = (rankAvg.data || []).map((r: any) => r.podiverzum_rank || 0);
    const avg = ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : 0;
    setStats({
      refreshedToday: pods.data?.length || 0,
      autoAddedToday: autoAdd.data?.length || 0,
      queueCount: queue.count || 0,
      failedFeeds: failed.count || 0,
      avgRank: Math.round(avg * 10) / 10,
    });

    const { data: dumps } = await supabase.from("pi_dump_imports").select("*").order("created_at", { ascending: false }).limit(5);
    setDumpRuns(dumps || []);

    const { data: fRow } = await supabase.from("app_settings").select("value").eq("key", "foundation_import").maybeSingle();
    setFoundation((fRow?.value as any) || null);
    const { count: rem } = await supabase.from("pi_feed_staging").select("id", { count: "exact", head: true }).eq("processed", false);
    setUnprocessed(rem || 0);

    const { data: hRow } = await supabase.from("app_settings").select("value").eq("key", "deep_hydration").maybeSingle();
    setHydration((hRow?.value as any) || null);
    const [ns, ip, cp, fl, el] = await Promise.all([
      supabase.from("podcasts").select("id", { count: "exact", head: true }).eq("deep_hydration_status", "not_started").in("rank_label", ["S", "A", "B", "C"]),
      supabase.from("podcasts").select("id", { count: "exact", head: true }).eq("deep_hydration_status", "in_progress"),
      supabase.from("podcasts").select("id", { count: "exact", head: true }).eq("deep_hydration_status", "completed"),
      supabase.from("podcasts").select("id", { count: "exact", head: true }).eq("deep_hydration_status", "failed"),
      supabase.from("podcasts").select("id", { count: "exact", head: true }).in("rank_label", ["S", "A", "B", "C"]).in("rss_status", ["active", "not_checked"]).in("deep_hydration_status", ["not_started", "failed"]),
    ]);
    setHydrationCounts({
      not_started: ns.count || 0,
      in_progress: ip.count || 0,
      completed: cp.count || 0,
      failed: fl.count || 0,
      eligible: el.count || 0,
    });
  };

  const runDeepHydrate = async (limit: number) => {
    setHydrating(true);
    setHydrationLimit(limit);
    try {
      const { data, error } = await supabase.functions.invoke("deep-hydrate-admin", { body: { action: "run_now", limit } });
      if (error) throw error;
      setLastHydrateResult(data?.ran || data);
      const ran = data?.ran || {};
      toast.success(`Hydrated ${ran?.processed || 0} podcasts (+${ran?.new_episodes || 0} eps, ${ran?.failed || 0} failed)`);
      await loadAll();
    } catch (e: any) {
      toast.error(e.message || "deep hydrate failed");
    } finally {
      setHydrating(false);
    }
  };

  const toggleAutoHydration = async (enable: boolean) => {
    try {
      const { data, error } = await supabase.functions.invoke("deep-hydrate-admin", {
        body: { action: enable ? "enable" : "disable" },
      });
      if (error) throw error;
      toast.success(`Automatic deep hydration ${enable ? "enabled" : "disabled"}`);
      setHydration({ ...(hydration || {}), ...(data?.setting || {}) });
      await loadAll();
    } catch (e: any) {
      toast.error(e.message || "toggle failed");
    }
  };

  const runFoundationBatch = async (continueLoop = false) => {
    if (continueLoop) setFoundationContinue(true); else setFoundationRunning(true);
    try {
      do {
        const { data, error } = await supabase.functions.invoke("foundation-runner", { body: { batch: 250, max_batches: continueLoop ? 8 : 1 } });
        if (error) throw error;
        toast.success(`Foundation: +${data?.run?.auto_added || 0} added, ${data?.run?.queued || 0} queued, ${data?.unprocessed_remaining || 0} left`);
        await loadAll();
        if (!continueLoop) break;
        if ((data?.unprocessed_remaining || 0) === 0) break;
        if (data?.stopped_reason && data.stopped_reason !== "time_budget") break;
      } while (continueLoop);
    } catch (e: any) {
      toast.error(e.message || "foundation failed");
    } finally {
      setFoundationRunning(false); setFoundationContinue(false);
    }
  };

  const processDumpBatch = async () => {
    setProcessingDump(true);
    try {
      const { data, error } = await supabase.functions.invoke("pi-dump-process", { body: { batch: 100 } });
      if (error) throw error;
      toast.success(`Processed ${data?.processed || 0} feeds (+${data?.counters?.auto_added || 0} added, ${data?.counters?.queued || 0} queued)`);
      await loadAll();
    } catch (e: any) {
      toast.error(e.message || "process failed");
    } finally {
      setProcessingDump(false);
    }
  };

  const runRecentIngest = async () => {
    setRecentIngesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("pi-recent-ingest", { body: { max: 500, since_days: 2, lang: "en" } });
      if (error) throw error;
      toast.success(`Fetched ${data?.fetched || 0}, staged ${data?.inserted || 0}`);
      await loadAll();
    } catch (e: any) {
      toast.error(e.message || "ingest failed");
    } finally { setRecentIngesting(false); }
  };

  const submitPaste = async () => {
    const urls = pasteUrls.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length && !pasteOpml.trim()) { toast.error("Paste URLs or OPML"); return; }
    setPasteSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("pi-opml-ingest", { body: { urls, opml: pasteOpml } });
      if (error) throw error;
      toast.success(`Staged ${data?.inserted || 0} of ${data?.received || 0}`);
      setPasteUrls(""); setPasteOpml("");
      await loadAll();
    } catch (e: any) {
      toast.error(e.message || "submit failed");
    } finally { setPasteSubmitting(false); }
  };
  const save = async () => {
    const cats = catsInput.split(",").map((s) => s.trim()).filter(Boolean);
    const next = { ...settings, discovery_categories: cats };
    const { error } = await supabase.from("app_settings").upsert({ key: "growth", value: next, updated_at: new Date().toISOString() });
    if (error) toast.error(error.message); else { toast.success("Saved"); setSettings(next); }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("daily-growth-run", { body: { trigger: "manual", force: true } });
      if (error) throw error;
      toast.success(`Run complete: +${data?.stats?.auto_added || 0} added, ${data?.stats?.refreshed || 0} refreshed`);
      await loadAll();
    } catch (e: any) {
      toast.error(e.message || "run failed");
    } finally {
      setRunning(false);
    }
  };

  if (!ready) return <Layout><div className="container py-8">Loading…</div></Layout>;
  if (!allowed) return <Layout><div className="container py-8">Admin access required.</div></Layout>;

  return (
    <Layout>
      <div className="container py-6 space-y-6 max-w-5xl">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Autonomous Growth</h1>
            <p className="text-sm text-muted-foreground">Self-growing pipeline driven by Podiverzum Rank.</p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline"><Link to="/admin">Back to Admin</Link></Button>
            <Button asChild variant="outline"><Link to="/admin/queue">Approval Queue ({stats.queueCount})</Link></Button>
            <Button onClick={runNow} disabled={running}>{running ? "Running…" : "Run growth cycle now"}</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Refreshed (24h)</div><div className="text-2xl font-semibold">{stats.refreshedToday}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Auto-added (24h)</div><div className="text-2xl font-semibold">{stats.autoAddedToday}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Approval queue</div><div className="text-2xl font-semibold">{stats.queueCount}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Failed feeds</div><div className="text-2xl font-semibold">{stats.failedFeeds}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Avg Podiverzum Rank</div><div className="text-2xl font-semibold">{stats.avgRank}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <Label>Autonomous growth</Label>
                <p className="text-xs text-muted-foreground">Master switch. When off, scheduled runs no-op.</p>
              </div>
              <Switch checked={!!settings.autonomous_growth_enabled} onCheckedChange={(v) => setSettings({ ...settings, autonomous_growth_enabled: v })} />
            </div>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <Label>Auto-add (rank ≥ {settings.min_rank_for_auto_add})</Label>
                <p className="text-xs text-muted-foreground">Insert high-rank candidates directly. Otherwise queue them.</p>
              </div>
              <Switch checked={!!settings.auto_add_enabled} onCheckedChange={(v) => setSettings({ ...settings, auto_add_enabled: v })} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <Label>Min rank for auto-add</Label>
                <Input type="number" min={1} max={10} value={settings.min_rank_for_auto_add} onChange={(e) => setSettings({ ...settings, min_rank_for_auto_add: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Max auto-add per run</Label>
                <Input type="number" min={1} max={20} value={settings.max_auto_add_per_run} onChange={(e) => setSettings({ ...settings, max_auto_add_per_run: Math.min(20, Number(e.target.value)) })} />
              </div>
              <div>
                <Label>Max discovery candidates / run</Label>
                <Input type="number" min={1} max={50} value={settings.max_discovery_per_run} onChange={(e) => setSettings({ ...settings, max_discovery_per_run: Math.min(50, Number(e.target.value)) })} />
              </div>
              <div>
                <Label>Max AI summaries / day</Label>
                <Input type="number" min={0} value={settings.max_ai_summaries_per_day} onChange={(e) => setSettings({ ...settings, max_ai_summaries_per_day: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Latest episode within (days)</Label>
                <Input type="number" min={1} value={settings.max_episode_age_days} onChange={(e) => setSettings({ ...settings, max_episode_age_days: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Language</Label>
                <Input value={settings.language} onChange={(e) => setSettings({ ...settings, language: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Discovery categories (comma separated)</Label>
              <Input value={catsInput} onChange={(e) => setCatsInput(e.target.value)} placeholder="technology, business, science" />
            </div>
            <Button onClick={save}>Save settings</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Last run</CardTitle></CardHeader>
          <CardContent>
            {!lastRun ? <p className="text-sm text-muted-foreground">No runs yet.</p> : (
              <div className="text-sm space-y-1">
                <div>Started: {new Date(lastRun.started_at).toLocaleString()}</div>
                <div>Finished: {lastRun.finished_at ? new Date(lastRun.finished_at).toLocaleString() : "—"}</div>
                <div>Status: {lastRun.ok ? "OK" : (lastRun.error || "running")}</div>
                <pre className="text-xs bg-muted p-3 rounded mt-2 overflow-auto">{JSON.stringify(lastRun.stats, null, 2)}</pre>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle>One-time Foundation Import</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => runFoundationBatch(false)} disabled={foundationRunning || foundationContinue}>
                  {foundationRunning ? "Running…" : "Process next foundation batch (250)"}
                </Button>
                <Button size="sm" variant="default" onClick={() => runFoundationBatch(true)} disabled={foundationRunning || foundationContinue}>
                  {foundationContinue ? "Continuing…" : "Continue until done"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Builds initial content base. Foundation mode imports every Rank ≥ 4 candidate (index-only for 4–5; promotion-eligible at ≥ 6). Episodes per podcast: Rank 8–10 → 75, Rank 6–7 → 50, Rank 4–5 → 30. Rank ≤ 3 hidden. "Continue until done" loops batches inside the runner until the time budget is hit; click again to resume.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Unprocessed staged" value={unprocessed} />
              <Stat label="Foundation podcasts added" value={foundation?.totals?.auto_added ?? 0} />
              <Stat label="Indexed (Rank 4–5)" value={foundation?.totals?.queued ?? 0} />
              <Stat label="Hidden (Rank ≤ 3)" value={foundation?.totals?.hidden_low_rank ?? 0} />
              <Stat label="Duplicates skipped" value={foundation?.totals?.skipped_duplicates ?? 0} />
              <Stat label="Failed RSS" value={foundation?.totals?.failed_rss_tests ?? 0} />
              <Stat label="Batches run" value={foundation?.totals?.batches ?? 0} />
              <Stat label="Last stop reason" value={foundation?.last_stopped_reason || "—"} />
            </div>
            {foundation?.last_finished_at && (
              <div className="text-xs text-muted-foreground">Last run finished: {new Date(foundation.last_finished_at).toLocaleString()}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle>Deep Hydration</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => runDeepHydrate(5)} disabled={hydrating}>
                  {hydrating && hydrationLimit === 5 ? "Hydrating…" : "Deep hydrate next 5 podcasts"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => runDeepHydrate(10)} disabled={hydrating}>
                  {hydrating && hydrationLimit === 10 ? "Hydrating…" : "Deep hydrate next 10"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-xs px-2 py-1 rounded border ${hydration?.enabled ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                Auto: {hydration?.enabled ? "ENABLED" : "DISABLED"}
              </span>
              <Button size="sm" variant={hydration?.enabled ? "outline" : "default"} onClick={() => toggleAutoHydration(true)} disabled={!!hydration?.enabled}>
                Enable automatic deep hydration
              </Button>
              <Button size="sm" variant="outline" onClick={() => toggleAutoHydration(false)} disabled={!hydration?.enabled}>
                Disable automatic deep hydration
              </Button>
              <span className="text-xs text-muted-foreground">Batch: {hydration?.batch_size ?? 5} · Schedule: {hydration?.schedule_mode ?? "nightly"} (00–05 UTC hourly)</span>
            </div>
            <p className="text-muted-foreground">
              Re-fetches RSS for accepted podcasts (Rank ≥ 4) with higher caps. Targets: Rank 9–10 → 150, Rank 8 → 100, Rank 6–7 → 75, Rank 4–5 → 40. Once completed, daily refresh switches to a small fresh-only cap (15 items). If targets are raised later, completed podcasts can be reset/re-queued.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Stat label="Eligible" value={hydrationCounts.eligible} />
              <Stat label="Not started" value={hydrationCounts.not_started} />
              <Stat label="In progress" value={hydrationCounts.in_progress} />
              <Stat label="Completed" value={hydrationCounts.completed} />
              <Stat label="Failed" value={hydrationCounts.failed} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Last run processed" value={hydration?.last_run?.processed ?? 0} />
              <Stat label="Last run +episodes" value={hydration?.last_run?.new_episodes ?? 0} />
              <Stat label="Total processed" value={hydration?.totals?.processed ?? 0} />
              <Stat label="Total +episodes" value={hydration?.totals?.new_episodes ?? 0} />
            </div>
            {hydration?.last_run?.finished_at && (
              <div className="text-xs text-muted-foreground">Last hydration: {new Date(hydration.last_run.finished_at).toLocaleString()} · trigger: {hydration.last_run.trigger || "—"} · remaining eligible: {hydration.last_run.remaining_eligible ?? 0}</div>
            )}
            <pre className="text-xs bg-muted p-3 rounded overflow-auto">{`-- Hourly nightly auto deep hydration (00–05 UTC)
select cron.schedule(
  'podiverzum-deep-hydration-nightly',
  '0 0-5 * * *',
  $$ select net.http_post(
    url:='${import.meta.env.VITE_SUPABASE_URL}/functions/v1/deep-hydrate-admin',
    headers:='{"Content-Type":"application/json","apikey":"${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}"}'::jsonb,
    body:='{"action":"scheduled_run"}'::jsonb
  ); $$
);`}</pre>
            {lastHydrateResult?.per_podcast_results?.length > 0 && (
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 pr-2">Podcast</th>
                      <th className="py-1 pr-2">Rank</th>
                      <th className="py-1 pr-2">Target</th>
                      <th className="py-1 pr-2">Total eps</th>
                      <th className="py-1 pr-2">+New</th>
                      <th className="py-1 pr-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastHydrateResult.per_podcast_results.map((r: any) => (
                      <tr key={r.id} className="border-t">
                        <td className="py-1 pr-2 truncate max-w-[180px]">{r.title}</td>
                        <td className="py-1 pr-2">{r.rank}</td>
                        <td className="py-1 pr-2">{r.target}</td>
                        <td className="py-1 pr-2">{r.total_episodes ?? "—"}</td>
                        <td className="py-1 pr-2">{r.new_episodes ?? "—"}</td>
                        <td className="py-1 pr-2">{r.status}{r.reason ? ` (${r.reason})` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle>Recent feeds ingest (Lovable Cloud-only)</CardTitle>
              <Button size="sm" onClick={runRecentIngest} disabled={recentIngesting}>
                {recentIngesting ? "Fetching…" : "Run recent-feeds ingest now"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p className="text-muted-foreground">
              Pulls Podcast Index <code>/recent/newfeeds</code> + <code>/recent/feeds</code> (capped, no pagination, no search) and stages English feeds. Schedule daily, then click <em>Process next batch</em> below.
            </p>
            <pre className="text-xs bg-muted p-3 rounded overflow-auto">{`-- Daily auto ingest at 03:30 UTC
select cron.schedule(
  'podiverzum-pi-recent-ingest',
  '30 3 * * *',
  $$ select net.http_post(
    url:='${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pi-recent-ingest',
    headers:='{"Content-Type":"application/json","apikey":"${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}"}'::jsonb,
    body:='{"max":500,"since_days":2,"lang":"en"}'::jsonb
  ); $$
);

-- Process staged feeds every 30 min (5 auto-adds/run)
select cron.schedule(
  'podiverzum-pi-dump-process',
  '*/30 * * * *',
  $$ select net.http_post(
    url:='${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pi-dump-process',
    headers:='{"Content-Type":"application/json","apikey":"${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}"}'::jsonb,
    body:='{"batch":100}'::jsonb
  ); $$
);`}</pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Add feeds from iPhone (paste URLs or OPML)</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <Label>RSS URLs (one per line)</Label>
              <Textarea rows={4} value={pasteUrls} onChange={(e) => setPasteUrls(e.target.value)} placeholder="https://example.com/feed.xml" />
            </div>
            <div>
              <Label>OPML (paste XML)</Label>
              <Textarea rows={4} value={pasteOpml} onChange={(e) => setPasteOpml(e.target.value)} placeholder="<opml>…</opml>" />
            </div>
            <Button size="sm" onClick={submitPaste} disabled={pasteSubmitting}>
              {pasteSubmitting ? "Submitting…" : "Stage these feeds"}
            </Button>
            <p className="text-xs text-muted-foreground">Staged feeds are processed by the same pipeline (rank ≥ {settings.min_rank_for_auto_add} auto-add, 6–7 queue, ≤ 5 hide).</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle>Podcast Index full database import</CardTitle>
              <Button size="sm" onClick={processDumpBatch} disabled={processingDump}>
                {processingDump ? "Processing…" : "Process next batch (100)"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Bulk discovery from the weekly Podcast Index SQLite dump. Operator runs a local script that POSTs NDJSON batches to <code>pi-dump-ingest</code> with the service-role bearer token. This processor scores staged feeds, auto-adds rank ≥ {settings.min_rank_for_auto_add}, queues 6–7, hides ≤ 5, then hydrates RSS (max 30 episodes/podcast). No API crawling.
            </p>
            {dumpRuns.length === 0 ? (
              <p className="text-muted-foreground">No dump imports yet.</p>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 pr-2">Snapshot</th><th className="py-1 pr-2">Status</th>
                      <th className="py-1 pr-2">Received</th><th className="py-1 pr-2">Scanned</th>
                      <th className="py-1 pr-2">Accepted</th><th className="py-1 pr-2">Rejected</th>
                      <th className="py-1 pr-2">Auto-added</th><th className="py-1 pr-2">Queued</th>
                      <th className="py-1 pr-2">Hidden</th><th className="py-1 pr-2">Dup</th>
                      <th className="py-1 pr-2">RSS fail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dumpRuns.map((d) => (
                      <tr key={d.id} className="border-t">
                        <td className="py-1 pr-2">{d.snapshot_date || new Date(d.created_at).toLocaleDateString()}</td>
                        <td className="py-1 pr-2">{d.status}</td>
                        <td className="py-1 pr-2">{d.feeds_received}</td>
                        <td className="py-1 pr-2">{d.feeds_scanned}</td>
                        <td className="py-1 pr-2">{d.candidates_accepted}</td>
                        <td className="py-1 pr-2">{d.candidates_rejected}</td>
                        <td className="py-1 pr-2">{d.auto_added}</td>
                        <td className="py-1 pr-2">{d.queued}</td>
                        <td className="py-1 pr-2">{d.hidden_low_rank}</td>
                        <td className="py-1 pr-2">{d.skipped_duplicates}</td>
                        <td className="py-1 pr-2">{d.failed_rss_tests}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cron setup (twice daily)</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <p>Run the growth cycle at <strong>04:00 UTC</strong> and <strong>16:00 UTC</strong>. Add this SQL once via the database tool:</p>
            <pre className="text-xs bg-muted p-3 rounded overflow-auto">{`-- Enable extensions (one-time)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'podiverzum-growth-04utc',
  '0 4 * * *',
  $$ select net.http_post(
    url:='${import.meta.env.VITE_SUPABASE_URL}/functions/v1/daily-growth-run',
    headers:='{"Content-Type":"application/json","apikey":"${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}"}'::jsonb,
    body:='{"trigger":"cron"}'::jsonb
  ); $$
);

select cron.schedule(
  'podiverzum-growth-16utc',
  '0 16 * * *',
  $$ select net.http_post(
    url:='${import.meta.env.VITE_SUPABASE_URL}/functions/v1/daily-growth-run',
    headers:='{"Content-Type":"application/json","apikey":"${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}"}'::jsonb,
    body:='{"trigger":"cron"}'::jsonb
  ); $$
);`}</pre>
            <p className="text-muted-foreground">Cron runs respect the <em>Autonomous growth</em> switch. Manual “Run now” always executes (force=true).</p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border rounded p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}
