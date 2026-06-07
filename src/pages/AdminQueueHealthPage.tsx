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
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Activity, Play, RefreshCw, Save } from "lucide-react";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

type RunnerCfg = {
  name: string;
  controls_key: string;
  pending_kind: string;
  wake_threshold?: number;
  stall_runs?: number;
};

type State = {
  enabled?: boolean;
  dry_run?: boolean;
  runners?: RunnerCfg[];
  history?: Record<string, { p1?: number; p2?: number; updated_at?: string }>;
  last_check_at?: string;
  last_results?: any[];
};

type EventRow = {
  id: string;
  runner: string;
  action: string;
  reason: string;
  pending_now: number | null;
  pending_prev: number | null;
  pending_prev_prev: number | null;
  created_at: string;
};

export default function AdminQueueHealthPage() {
  useNoindex("Queue Health Controller — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { wake: number; stall: number }>>({});

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      const { data: hasAdmin } = await supabase.rpc("has_role", { _user_id: uid, _role: "admin" });
      const admin = hasAdmin === true || uid === TEMP_ADMIN_USER_ID;
      setIsAdmin(admin);
      setReady(true);
      if (admin) load();
    })();
  }, [nav]);

  const load = async () => {
    setLoading(true);
    const [{ data: row }, { data: ev }] = await Promise.all([
      supabase.from("app_settings").select("value").eq("key", "queue_health_state").maybeSingle(),
      supabase.from("queue_health_events").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    const v = (row?.value || {}) as State;
    setState(v);
    setEvents((ev || []) as EventRow[]);
    const d: Record<string, { wake: number; stall: number }> = {};
    for (const r of v.runners || []) d[r.name] = { wake: r.wake_threshold ?? 5, stall: r.stall_runs ?? 2 };
    setDrafts(d);
    setLoading(false);
  };

  const saveState = async (next: State) => {
    await supabase.from("app_settings").upsert({ key: "queue_health_state", value: next as any, updated_at: new Date().toISOString() }, { onConflict: "key" });
    toast({ title: "Mentve" });
    load();
  };

  const toggle = async (k: "enabled" | "dry_run", v: boolean) => {
    if (!state) return;
    await saveState({ ...state, [k]: v });
  };

  const saveRunner = async (name: string) => {
    if (!state?.runners) return;
    const d = drafts[name];
    const runners = state.runners.map((r) => r.name === name ? { ...r, wake_threshold: Number(d.wake), stall_runs: Number(d.stall) } : r);
    await saveState({ ...state, runners });
  };

  const runNow = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("queue-health-controller", { body: {} });
    if (error) toast({ title: "Hiba", description: error.message, variant: "destructive" });
    else toast({ title: "Lefutott", description: `${data?.checked ?? 0} runner, ${data?.tg_sent ?? 0} Telegram` });
    await load();
  };

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20"><h1 className="text-2xl font-semibold">Not authorized</h1></div></Layout>;

  const runners = state?.runners || [];
  const history = state?.history || {};
  const lastResults: Record<string, any> = {};
  for (const r of state?.last_results || []) lastResults[r.runner] = r;

  return (
    <Layout>
      <div className="container mx-auto py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold flex items-center gap-2">
            <Activity className="h-7 w-7 text-primary" />
            Queue Health Controller
          </h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
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
                <div className="font-medium">Engedélyezve</div>
                <div className="text-sm text-muted-foreground">Master kapcsoló. Off = nem fut a check.</div>
              </div>
              <Switch checked={state?.enabled ?? false} onCheckedChange={(v) => toggle("enabled", v)} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Dry-run {state?.dry_run && <Badge variant="secondary" className="ml-2">DRY</Badge>}</div>
                <div className="text-sm text-muted-foreground">ON = csak naplóz, nem nyúl a controls-hoz. OFF = ÉLES auto-pause/resume.</div>
              </div>
              <Switch checked={state?.dry_run ?? true} onCheckedChange={(v) => toggle("dry_run", v)} />
            </div>
            <div className="text-xs text-muted-foreground border-t pt-2">
              Utolsó futás: {state?.last_check_at ? new Date(state.last_check_at).toLocaleString("hu-HU") : "—"}
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
                  <TableHead>Pending kind</TableHead>
                  <TableHead className="text-right">Pending now</TableHead>
                  <TableHead className="text-right">p1 / p2</TableHead>
                  <TableHead className="w-24">Wake</TableHead>
                  <TableHead className="w-24">Stall runs</TableHead>
                  <TableHead>Last action</TableHead>
                  <TableHead className="text-right">Save</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runners.map((r) => {
                  const h = history[r.name] || {};
                  const lr = lastResults[r.name];
                  return (
                    <TableRow key={r.name}>
                      <TableCell className="font-mono text-sm">{r.name}<div className="text-xs text-muted-foreground">{r.controls_key}</div></TableCell>
                      <TableCell className="text-xs">{r.pending_kind}</TableCell>
                      <TableCell className="text-right font-mono">{lr?.pending ?? h.p1 ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{h.p1 ?? "—"} / {h.p2 ?? "—"}</TableCell>
                      <TableCell>
                        <Input type="number" min={0} value={drafts[r.name]?.wake ?? r.wake_threshold ?? 5}
                          onChange={(e) => setDrafts({ ...drafts, [r.name]: { ...drafts[r.name], wake: Number(e.target.value) } })} />
                      </TableCell>
                      <TableCell>
                        <Input type="number" min={2} value={drafts[r.name]?.stall ?? r.stall_runs ?? 2}
                          onChange={(e) => setDrafts({ ...drafts, [r.name]: { ...drafts[r.name], stall: Number(e.target.value) } })} />
                      </TableCell>
                      <TableCell className="text-xs">
                        {lr?.action === "noop" || !lr?.action ? <span className="text-muted-foreground">noop</span> :
                          <Badge variant={lr.action.startsWith("pause") ? "destructive" : "default"}>{lr.action}</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => saveRunner(r.name)}>
                          <Save className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
                  <TableHead>Action</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Pending (now / p1 / p2)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(e.created_at).toLocaleString("hu-HU")}</TableCell>
                    <TableCell className="font-mono text-xs">{e.runner}</TableCell>
                    <TableCell>
                      <Badge variant={e.action.startsWith("pause") ? "destructive" : "default"}>{e.action}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{e.reason}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{e.pending_now} / {e.pending_prev ?? "—"} / {e.pending_prev_prev ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {!events.length && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Még nincs event.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
