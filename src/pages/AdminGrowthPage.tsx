import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
