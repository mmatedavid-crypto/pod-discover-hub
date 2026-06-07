import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNoindex } from "@/lib/useNoindex";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Activity, Pause, Play, RefreshCw, Save, ShieldCheck, TestTube2 } from "lucide-react";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";
const CONTROLS_KEY = "spotify_transcript_controls";
const STATE_KEY = "spotify_transcript_state";
const PROGRESS_KEY = "spotify_transcript_progress";

type SpotifyControls = {
  enabled?: boolean;
  batch_size?: number;
  delay_ms?: number;
  daily_cap?: number;
  time_budget_ms?: number;
  policy?: string;
  model?: string;
  cron_job?: string;
  cron_schedule?: string;
  rights_status?: string;
  public_display?: boolean;
  paused_at?: string | null;
  paused_reason?: string | null;
};

type SpotifyState = {
  date?: string;
  calls?: number;
  written?: number;
  skipped?: number;
  errors?: number;
};

type SpotifyProgress = {
  last_run_at?: string;
  status?: string;
  candidates?: number;
  calls_last_run?: number;
  written?: number;
  skipped?: number;
  errors_last_run?: number;
  batch_size?: number;
  delay_ms?: number;
  daily_cap?: number;
  model?: string;
  policy?: string;
  status_counts?: Record<string, number>;
  error_samples?: Array<{ episode_id?: string; spotify_episode_id?: string; status?: string; message?: string }>;
};

const defaultControls: SpotifyControls = {
  enabled: false,
  batch_size: 10,
  delay_ms: 1000,
  daily_cap: 100,
  time_budget_ms: 70000,
  policy: "default_disabled_operator_controlled_native_transcript_indexing_v1",
  model: "spotify-native",
  cron_job: "podiverzum-spotify-transcript-runner",
  cron_schedule: "*/5 * * * *",
  rights_status: "spotify_private_api_index_only",
  public_display: false,
};

export default function AdminSpotifyTranscriptPage() {
  useNoindex("Spotify Transcript Runner — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [controls, setControls] = useState<SpotifyControls>(defaultControls);
  const [state, setState] = useState<SpotifyState>({});
  const [progress, setProgress] = useState<SpotifyProgress>({});
  const [lastRun, setLastRun] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
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
    const { data, error } = await supabase
      .from("app_settings")
      .select("key,value")
      .in("key", [CONTROLS_KEY, STATE_KEY, PROGRESS_KEY]);
    if (error) {
      toast({ title: "Betöltési hiba", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const rows = new Map((data || []).map((row: any) => [row.key, row.value || {}]));
    setControls({ ...defaultControls, ...((rows.get(CONTROLS_KEY) || {}) as SpotifyControls) });
    setState((rows.get(STATE_KEY) || {}) as SpotifyState);
    setProgress((rows.get(PROGRESS_KEY) || {}) as SpotifyProgress);
    setLoading(false);
  };

  const saveControls = async (next = controls) => {
    setSaving(true);
    const payload = {
      ...defaultControls,
      ...next,
      enabled: next.enabled === true,
      public_display: false,
      rights_status: next.rights_status || defaultControls.rights_status,
      policy: next.policy || defaultControls.policy,
      model: "spotify-native",
    };
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: CONTROLS_KEY, value: payload as any, updated_at: new Date().toISOString() }, { onConflict: "key" });
    setSaving(false);
    if (error) {
      toast({ title: "Mentési hiba", description: error.message, variant: "destructive" });
      return;
    }
    setControls(payload);
    toast({ title: "Mentve" });
    await load();
  };

  const toggleEnabled = async (enabled: boolean) => {
    const next = {
      ...controls,
      enabled,
      paused_at: enabled ? null : new Date().toISOString(),
      paused_reason: enabled ? null : "operator_paused",
    };
    setControls(next);
    await saveControls(next);
  };

  const run = async (mode: "pilot" | "batch") => {
    setLoading(true);
    const body = mode === "pilot"
      ? { pilot: 1, batch: 1, delay_ms: controls.delay_ms }
      : { batch: controls.batch_size, delay_ms: controls.delay_ms };
    const { data, error } = await supabase.functions.invoke("spotify-transcript-runner", { body });
    setLastRun(data || null);
    if (error) toast({ title: "Runner hiba", description: error.message, variant: "destructive" });
    else toast({ title: mode === "pilot" ? "Pilot lefutott" : "Batch lefutott", description: data?.reason || data?.status || "ok" });
    await load();
    setLoading(false);
  };

  const statusCounts = useMemo(() => Object.entries(progress.status_counts || {}).sort(([a], [b]) => a.localeCompare(b)), [progress.status_counts]);
  const errorSamples = progress.error_samples || [];

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20"><h1 className="text-2xl font-semibold">Not authorized</h1></div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto py-8 space-y-6 max-w-6xl">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold flex items-center gap-2">
              <Activity className="h-7 w-7 text-primary" />
              Spotify Transcript Runner
            </h1>
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant={controls.enabled ? "default" : "secondary"}>{controls.enabled ? "enabled" : "paused"}</Badge>
              <Badge variant="outline">{controls.model || "spotify-native"}</Badge>
              <Badge variant={controls.public_display ? "destructive" : "secondary"}>public display: {String(controls.public_display === true)}</Badge>
              <Badge variant="outline">{controls.rights_status || defaultControls.rights_status}</Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => run("pilot")} disabled={loading}>
              <TestTube2 className="h-4 w-4 mr-2" />
              Pilot 1
            </Button>
            <Button size="sm" onClick={() => run("batch")} disabled={loading || !controls.enabled}>
              <Play className="h-4 w-4 mr-2" />
              Run batch
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Candidates" value={progress.candidates} />
          <Stat label="Calls last run" value={progress.calls_last_run} />
          <Stat label="Written" value={progress.written} />
          <Stat label="Skipped" value={progress.skipped} />
          <Stat label="Errors" value={progress.errors_last_run} tone={progress.errors_last_run ? "danger" : "default"} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Controls</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {controls.enabled ? <Play className="h-4 w-4 text-primary" /> : <Pause className="h-4 w-4 text-muted-foreground" />}
                    Enabled
                  </div>
                  <div className="text-xs text-muted-foreground">Cron csak bekapcsolt állapotban ír transcriptet.</div>
                </div>
                <Switch checked={controls.enabled === true} onCheckedChange={toggleEnabled} />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <NumberField label="Batch" value={controls.batch_size ?? 10} min={1} max={25} onChange={(v) => setControls({ ...controls, batch_size: v })} />
                <NumberField label="Delay ms" value={controls.delay_ms ?? 1000} min={250} step={250} onChange={(v) => setControls({ ...controls, delay_ms: v })} />
                <NumberField label="Daily cap" value={controls.daily_cap ?? 100} min={1} onChange={(v) => setControls({ ...controls, daily_cap: v })} />
                <NumberField label="Budget ms" value={controls.time_budget_ms ?? 70000} min={10000} step={5000} onChange={(v) => setControls({ ...controls, time_budget_ms: v })} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <Info label="Cron" value={`${controls.cron_job || defaultControls.cron_job} · ${controls.cron_schedule || defaultControls.cron_schedule}`} />
                <Info label="Policy" value={controls.policy || defaultControls.policy || "-"} />
                <Info label="Paused at" value={controls.paused_at ? new Date(controls.paused_at).toLocaleString("hu-HU") : "-"} />
                <Info label="Paused reason" value={controls.paused_reason || "-"} />
              </div>

              <Button onClick={() => saveControls()} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                Save controls
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Guardrails</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Info label="Public display" value={String(controls.public_display === true)} />
              <Info label="Rights status" value={controls.rights_status || defaultControls.rights_status || "-"} />
              <Info label="State date" value={state.date || "-"} />
              <Info label="Daily calls" value={`${state.calls ?? 0} / ${controls.daily_cap ?? 0}`} />
              <Info label="Daily written" value={String(state.written ?? 0)} />
              <Info label="Daily skipped" value={String(state.skipped ?? 0)} />
              <Info label="Daily errors" value={String(state.errors ?? 0)} />
              <Info label="Last run" value={progress.last_run_at ? new Date(progress.last_run_at).toLocaleString("hu-HU") : "-"} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Status counts</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {statusCounts.map(([status, count]) => <Stat key={status} label={status} value={count} />)}
              {!statusCounts.length && <div className="text-sm text-muted-foreground">Nincs status count.</div>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Error samples</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Episode</TableHead>
                  <TableHead>Spotify</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errorSamples.map((e, idx) => (
                  <TableRow key={`${e.episode_id || idx}-${e.spotify_episode_id || "sample"}`}>
                    <TableCell className="font-mono text-xs">{e.episode_id || "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{e.spotify_episode_id || "-"}</TableCell>
                    <TableCell><Badge variant="secondary">{e.status || "error"}</Badge></TableCell>
                    <TableCell className="text-sm">{e.message || "-"}</TableCell>
                  </TableRow>
                ))}
                {!errorSamples.length && (
                  <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Nincs error sample.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {lastRun && (
          <Card>
            <CardHeader><CardTitle>Last manual response</CardTitle></CardHeader>
            <CardContent>
              <pre className="max-h-72 overflow-auto rounded-md bg-secondary p-3 text-xs">{JSON.stringify(lastRun, null, 2)}</pre>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-mono text-xs">{value}</div>
    </div>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value?: number; tone?: "default" | "danger" }) {
  const toneClass = tone === "danger" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value ?? 0}</div>
    </div>
  );
}
