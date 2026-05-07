import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNoindex } from "@/lib/useNoindex";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Play, Pause, Square, RefreshCw, Activity } from "lucide-react";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

type State = {
  state: "stopped" | "running" | "paused";
  source: "auto" | "recent" | "topics" | "search_demand";
  batch: number;
  topics: string[];
  consecutive_errors: number;
  auto_stop_at_errors: number;
  last_tick_at: string | null;
  last_action: string | null;
  last_result: any;
  last_error: string | null;
  stopped_reason: string | null;
};

const DEFAULT_STATE: State = {
  state: "stopped",
  source: "auto",
  batch: 50,
  topics: ["productivity", "formula 1", "longevity", "ai healthcare", "startups", "personal finance", "history", "science"],
  consecutive_errors: 0,
  auto_stop_at_errors: 5,
  last_tick_at: null,
  last_action: null,
  last_result: null,
  last_error: null,
  stopped_reason: null,
};

export default function AdminAutopilotPage() {
  useNoindex("Admin · Growth Autopilot — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [state, setState] = useState<State>(DEFAULT_STATE);
  const [topicsInput, setTopicsInput] = useState("");
  const [counts, setCounts] = useState({ podcasts: 0, episodes: 0, unprocessed: 0, queuePending: 0 });
  const [latestImport, setLatestImport] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { nav("/auth"); return; }
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: user.id, _role: "admin" });
      const ok = hasAdmin === true || user.id === TEMP_ADMIN_USER_ID;
      setAllowed(ok);
      setReady(true);
      if (ok) { await loadAll(); startPoll(); }
    })();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPoll = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(loadAll, 8000);
  };

  const loadAll = async () => {
    const [{ data: row }, pods, eps, unp, queue, imp] = await Promise.all([
      supabase.from("app_settings").select("value").eq("key", "growth_autopilot").maybeSingle(),
      supabase.from("podcasts").select("*", { count: "exact", head: true }),
      supabase.from("episodes").select("*", { count: "exact", head: true }),
      supabase.from("pi_feed_staging").select("*", { count: "exact", head: true }).eq("processed", false),
      supabase.from("discovery_queue").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("pi_dump_imports").select("*").order("created_at", { ascending: false }).limit(1),
    ]);
    const next: State = { ...DEFAULT_STATE, ...((row?.value as any) || {}) };
    setState(next);
    setTopicsInput((next.topics || []).join(", "));
    setCounts({
      podcasts: pods.count ?? 0,
      episodes: eps.count ?? 0,
      unprocessed: unp.count ?? 0,
      queuePending: queue.count ?? 0,
    });
    setLatestImport(imp.data?.[0] || null);
  };

  const saveState = async (patch: Partial<State>, opts: { silent?: boolean } = {}) => {
    setBusy(true);
    const next = { ...state, ...patch };
    const { error } = await supabase.from("app_settings").upsert({
      key: "growth_autopilot", value: next as any, updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setState(next);
    if (!opts.silent) toast.success("Saved");
  };

  const start = async () => {
    await saveState({ state: "running", consecutive_errors: 0, last_error: null, stopped_reason: null });
    toast.success("Autopilot running. Tick every ~10 min.");
  };
  const pause = () => saveState({ state: "paused" });
  const stop = () => saveState({ state: "stopped", stopped_reason: "manual" });

  const tickNow = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("growth-autopilot", { body: { trigger: "manual" } });
      if (error) throw error;
      toast.success(`Tick: ${data?.action || "ok"}`);
      await loadAll();
    } catch (e: any) {
      toast.error(e?.message || "tick failed");
    } finally { setBusy(false); }
  };

  const saveTopics = () => {
    const arr = topicsInput.split(/[,\n]/).map((t) => t.trim()).filter(Boolean).slice(0, 16);
    saveState({ topics: arr });
  };

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!allowed) return <Layout><div className="container mx-auto py-20 text-sm">Not authorized.</div></Layout>;

  const stateColor =
    state.state === "running" ? "text-brand" :
    state.state === "paused" ? "text-yellow-500" : "text-muted-foreground";

  return (
    <Layout>
      <div className="container mx-auto py-6 sm:py-10 space-y-6 max-w-3xl">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-brand/15 text-brand flex items-center justify-center">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Growth Autopilot</h1>
              <p className="text-xs text-muted-foreground">Cloud-driven podcast index growth.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={loadAll} disabled={busy}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </header>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <span>Status</span>
              <span className={`text-sm font-mono uppercase ${stateColor}`}>{state.state}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Podcasts" value={counts.podcasts} />
              <Stat label="Episodes" value={counts.episodes} />
              <Stat label="Unprocessed" value={counts.unprocessed} tone={counts.unprocessed ? "warn" : "default"} />
              <Stat label="Queue" value={counts.queuePending} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Button onClick={start} disabled={busy || state.state === "running"} className="bg-brand text-brand-foreground hover:bg-brand/90">
                <Play className="h-4 w-4 mr-1" /> Start
              </Button>
              <Button onClick={pause} disabled={busy || state.state !== "running"} variant="outline">
                <Pause className="h-4 w-4 mr-1" /> Pause
              </Button>
              <Button onClick={stop} disabled={busy || state.state === "stopped"} variant="outline">
                <Square className="h-4 w-4 mr-1" /> Stop
              </Button>
            </div>
            <Button onClick={tickNow} disabled={busy} variant="secondary" className="w-full">
              Run one tick now
            </Button>
            {state.last_tick_at && (
              <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
                <div>Last tick: <span className="font-mono">{new Date(state.last_tick_at).toLocaleString()}</span></div>
                <div>Action: <span className="font-mono">{state.last_action || "—"}</span></div>
                {state.last_error && <div className="text-destructive">Error: {state.last_error}</div>}
                {state.stopped_reason && <div className="text-yellow-500">Stopped: {state.stopped_reason}</div>}
                <div>Consecutive errors: {state.consecutive_errors} (auto-stop at {state.auto_stop_at_errors})</div>
                {state.last_result && (
                  <pre className="text-[10px] bg-secondary/50 p-2 rounded overflow-x-auto max-h-40">
                    {JSON.stringify(state.last_result, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle>Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Source</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(["auto", "recent", "topics", "search_demand"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => saveState({ source: s }, { silent: true })}
                    className={`px-3 py-2 rounded-md border text-sm capitalize ${
                      state.source === s ? "border-brand bg-brand/10 text-brand" : "border-border bg-card hover:bg-secondary"
                    }`}
                  >
                    {s.replace("_", " ")}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                <b>auto</b> rotates recent → topics → search-demand. <b>recent</b>: PI fresh feeds.{" "}
                <b>topics</b>: PI search by your terms. <b>search_demand</b>: terms from low/zero-result searches in last 7d.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="batch" className="text-xs uppercase tracking-wider text-muted-foreground">
                Batch size (10–100)
              </Label>
              <Input
                id="batch" type="number" min={10} max={100}
                value={state.batch}
                onChange={(e) => setState({ ...state, batch: Number(e.target.value) || 50 })}
                onBlur={() => saveState({ batch: Math.max(10, Math.min(100, Number(state.batch) || 50)) }, { silent: true })}
              />
              <p className="text-[11px] text-muted-foreground">
                Max podcasts auto-imported per tick. Each import hydrates 30–75 episodes.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="topics" className="text-xs uppercase tracking-wider text-muted-foreground">
                Topics (comma or newline separated, max 16)
              </Label>
              <Textarea
                id="topics" rows={3}
                value={topicsInput}
                onChange={(e) => setTopicsInput(e.target.value)}
                placeholder="productivity, formula 1, longevity, ai healthcare"
              />
              <Button size="sm" variant="outline" onClick={saveTopics} disabled={busy}>Save topics</Button>
            </div>
          </CardContent>
        </Card>

        {latestImport && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Latest import</CardTitle></CardHeader>
            <CardContent className="text-xs space-y-1 font-mono">
              <div>Source: {latestImport.source} · Status: {latestImport.status}</div>
              <div>Received: {latestImport.feeds_received} · Scanned: {latestImport.feeds_scanned}</div>
              <div>Auto-added: {latestImport.auto_added} · Queued: {latestImport.queued} · Hidden: {latestImport.hidden_low_rank}</div>
              <div>Rejected: {latestImport.candidates_rejected} · Dupes: {latestImport.skipped_duplicates} · Failed RSS: {latestImport.failed_rss_tests}</div>
              <div className="text-muted-foreground">Updated: {new Date(latestImport.updated_at).toLocaleString()}</div>
            </CardContent>
          </Card>
        )}

        <Card className="border-dashed">
          <CardContent className="py-4 text-xs text-muted-foreground space-y-1">
            <div><b>Safety:</b> auto-stops after {state.auto_stop_at_errors} consecutive errors.</div>
            <div><b>Schedule:</b> automatic tick every 10 min while running. Each tick processes one batch or fetches new candidates.</div>
            <div><b>Visibility rules unchanged:</b> Rank ≥6 promotable, 4–5 search-only, ≤3 hidden.</div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "warn" }) {
  return (
    <div className="p-3 rounded-lg border border-border bg-card">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${tone === "warn" ? "text-brand" : ""}`}>{value.toLocaleString()}</div>
    </div>
  );
}
