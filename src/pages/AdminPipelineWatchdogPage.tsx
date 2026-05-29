import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNoindex } from "@/lib/useNoindex";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { ShieldAlert, Play, RefreshCw, Send } from "lucide-react";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

type RunnerStatus = {
  name: string;
  controls_key: string;
  enabled: boolean;
  auto_paused: boolean;
  auto_paused_reason: string | null;
  auto_paused_at: string | null;
  daily_budget_usd: number | null;
};

type WatchdogEvent = {
  id: string;
  runner: string;
  rule: string;
  severity: "info" | "warn" | "critical";
  reason: string;
  detail: any;
  auto_paused: boolean;
  dry_run: boolean;
  created_at: string;
  resolved_at: string | null;
  resolved_note: string | null;
};

type StatusPayload = {
  ok: boolean;
  state: {
    enabled: boolean;
    dry_run: boolean;
    last_check_at: string | null;
    last_events: number;
    alert_dedup_minutes: number;
    budget_overshoot_ratio: number;
  };
  runners: RunnerStatus[];
  recent_events: WatchdogEvent[];
};

async function callAdmin(action: string, body: any = {}) {
  const { data, error } = await supabase.functions.invoke("pipeline-watchdog-admin", {
    body,
    method: "POST",
    headers: {},
    // @ts-ignore — supabase-js auto-adds auth header
  });
  // supabase-js doesn't easily support querystring; use raw fetch instead
  const session = (await supabase.auth.getSession()).data.session;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pipeline-watchdog-admin?action=${encodeURIComponent(action)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(body),
  });
  return await r.json();
}

async function fetchStatus(): Promise<StatusPayload | null> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pipeline-watchdog-admin?action=status`;
  const session = (await supabase.auth.getSession()).data.session;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
  });
  if (!r.ok) return null;
  return await r.json();
}

function severityBadge(s: string) {
  if (s === "critical") return <Badge variant="destructive">critical</Badge>;
  if (s === "warn") return <Badge className="bg-amber-500 hover:bg-amber-600">warn</Badge>;
  return <Badge variant="secondary">info</Badge>;
}

export default function AdminPipelineWatchdogPage() {
  useNoindex("Pipeline Watchdog — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: uid, _role: "admin" });
      const admin = hasAdmin === true || uid === TEMP_ADMIN_USER_ID;
      setIsAdmin(admin);
      setReady(true);
      if (admin) load();
    })();
  }, [nav]);

  const load = async () => {
    setLoading(true);
    const d = await fetchStatus();
    setData(d);
    setLoading(false);
  };

  const toggleDryRun = async (v: boolean) => {
    await callAdmin("set_state", { dry_run: v });
    toast({ title: v ? "Dry-run aktív" : "ÉLES mód aktiválva", description: v ? "Csak alert, nincs auto-pause." : "Auto-pause bekapcsolva." });
    load();
  };

  const toggleEnabled = async (v: boolean) => {
    await callAdmin("set_state", { enabled: v });
    toast({ title: v ? "Watchdog bekapcsolva" : "Watchdog kikapcsolva" });
    load();
  };

  const resume = async (r: RunnerStatus) => {
    const res = await callAdmin("resume", { controls_key: r.controls_key, runner: r.name });
    if (res?.ok) toast({ title: `Resumed ${r.name}` });
    else toast({ title: "Resume failed", description: res?.error || "", variant: "destructive" });
    load();
  };

  const runNow = async () => {
    setLoading(true);
    const res = await callAdmin("run_now");
    toast({ title: "Watchdog futtatva", description: `${res?.new_events ?? 0} új event, ${res?.tg_sent ?? 0} Telegram alert` });
    await load();
  };

  const testTelegram = async () => {
    const res = await callAdmin("test_telegram");
    if (res?.ok) toast({ title: "Telegram teszt elküldve ✅" });
    else toast({ title: "Telegram teszt sikertelen", description: res?.error || JSON.stringify(res), variant: "destructive" });
  };

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20"><h1 className="text-2xl font-semibold">Not authorized</h1></div></Layout>;

  const state = data?.state;
  const runners = data?.runners ?? [];
  const events = data?.recent_events ?? [];

  return (
    <Layout>
      <div className="container mx-auto py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold flex items-center gap-2">
            <ShieldAlert className="h-7 w-7 text-primary" />
            Pipeline Watchdog
          </h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={testTelegram}>
              <Send className="h-4 w-4 mr-2" />
              Test Telegram
            </Button>
            <Button size="sm" onClick={runNow} disabled={loading}>
              <Play className="h-4 w-4 mr-2" />
              Run now
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>Globális állapot</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Watchdog engedélyezve</div>
                <div className="text-sm text-muted-foreground">Master kapcsoló — kikapcsolva nem fut a check.</div>
              </div>
              <Switch checked={state?.enabled ?? false} onCheckedChange={toggleEnabled} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Dry-run mód {state?.dry_run && <Badge variant="secondary" className="ml-2">DRY</Badge>}</div>
                <div className="text-sm text-muted-foreground">
                  ON = csak Telegram alert, nincs auto-pause. OFF = ÉLES, runner-eket leállíthat.
                </div>
              </div>
              <Switch checked={state?.dry_run ?? true} onCheckedChange={toggleDryRun} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t">
              <Stat label="Utolsó futás" value={state?.last_check_at ? new Date(state.last_check_at).toLocaleString("hu-HU") : "—"} />
              <Stat label="Utolsó events" value={String(state?.last_events ?? 0)} />
              <Stat label="Dedup ablak" value={`${state?.alert_dedup_minutes ?? 30} perc`} />
              <Stat label="Budget overshoot" value={`${((state?.budget_overshoot_ratio ?? 1.2) * 100).toFixed(0)}%`} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Runner-ek ({runners.length})</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Runner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Budget $/nap</TableHead>
                  <TableHead>Auto-pause ok</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runners.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-mono text-sm">{r.name}</TableCell>
                    <TableCell>
                      {r.auto_paused
                        ? <Badge variant="destructive">AUTO-PAUSED</Badge>
                        : r.enabled
                          ? <Badge className="bg-emerald-600 hover:bg-emerald-700">running</Badge>
                          : <Badge variant="secondary">disabled</Badge>}
                    </TableCell>
                    <TableCell>{r.daily_budget_usd ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-md truncate">
                      {r.auto_paused_reason || "—"}
                      {r.auto_paused_at && <div className="text-xs">{new Date(r.auto_paused_at).toLocaleString("hu-HU")}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.auto_paused && (
                        <Button size="sm" variant="outline" onClick={() => resume(r)}>Resume</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent events ({events.length})</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Runner</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(e.created_at).toLocaleString("hu-HU")}</TableCell>
                    <TableCell className="font-mono text-xs">{e.runner}</TableCell>
                    <TableCell className="text-xs">{e.rule}</TableCell>
                    <TableCell>{severityBadge(e.severity)}</TableCell>
                    <TableCell className="text-sm max-w-lg">{e.reason}</TableCell>
                    <TableCell className="text-xs">
                      {e.resolved_at
                        ? <Badge variant="secondary">resolved</Badge>
                        : e.auto_paused
                          ? <Badge variant="destructive">paused</Badge>
                          : e.dry_run ? <Badge variant="outline">dry-run</Badge> : <Badge>open</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
                {!events.length && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Még nincs event.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
