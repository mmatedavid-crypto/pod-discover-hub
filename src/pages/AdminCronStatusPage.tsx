import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNoindex } from "@/lib/useNoindex";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, RefreshCw } from "lucide-react";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

type Job = { jobid: number; jobname: string; schedule: string; active: boolean };
type Run = {
  jobid: number;
  status: string;
  start_time: string;
  end_time: string | null;
  duration_ms: number | null;
  return_message: string | null;
};
type Health = { generated_at: string; jobs: Job[]; recent_runs: Run[] };

const ACTIVE_ALLOWLIST = new Set([8, 10, 13]);

export default function AdminCronStatusPage() {
  useNoindex("Cron Status — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    setLoading(true); setErr(null);
    const { data, error } = await (supabase as any).rpc("get_cron_health");
    if (error) setErr(error.message);
    else setData(data as Health);
    setLoading(false);
  };

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20"><h1 className="text-2xl font-semibold">Not authorized</h1></div></Layout>;

  const jobs = data?.jobs ?? [];
  const runs = data?.recent_runs ?? [];
  const runsByJob = new Map<number, Run[]>();
  runs.forEach(r => {
    if (!runsByJob.has(r.jobid)) runsByJob.set(r.jobid, []);
    runsByJob.get(r.jobid)!.push(r);
  });

  const activeJobs = jobs.filter(j => j.active);
  const unexpectedActive = activeJobs.filter(j => !ACTIVE_ALLOWLIST.has(j.jobid));
  const failed = runs.filter(r => r.status !== "succeeded");

  return (
    <Layout>
      <div className="container mx-auto py-8 space-y-6 max-w-6xl">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-brand/15 text-brand flex items-center justify-center">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Cron Status</h1>
              <p className="text-xs text-muted-foreground">
                {data ? `Generated ${new Date(data.generated_at).toLocaleString()}` : "—"}
              </p>
            </div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card hover:bg-secondary text-sm disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </header>

        {err && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</div>
        )}

        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Total jobs" value={jobs.length} />
          <Stat label="Active jobs" value={activeJobs.length} tone={unexpectedActive.length ? "warn" : "default"} />
          <Stat label="Recent runs (6h)" value={runs.length} />
          <Stat label="Failed runs (6h)" value={failed.length} tone={failed.length ? "danger" : "default"} />
        </section>

        {unexpectedActive.length > 0 && (
          <div className="rounded-md border border-brand/30 bg-brand/10 px-4 py-3 text-sm text-brand">
            ⚠ Unexpected active cron jobs (allowlist: 8, 10, 13):{" "}
            {unexpectedActive.map(j => `#${j.jobid} ${j.jobname}`).join(", ")}
          </div>
        )}

        <Card>
          <CardHeader><CardTitle className="text-lg">Jobs</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Recent (6h)</TableHead>
                  <TableHead>Last status</TableHead>
                  <TableHead>Last run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map(j => {
                  const jr = runsByJob.get(j.jobid) ?? [];
                  const last = jr[0];
                  const failedCount = jr.filter(r => r.status !== "succeeded").length;
                  return (
                    <TableRow key={j.jobid}>
                      <TableCell className="font-mono text-xs">{j.jobid}</TableCell>
                      <TableCell className="text-sm">{j.jobname}</TableCell>
                      <TableCell className="font-mono text-xs">{j.schedule}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${j.active ? "bg-brand/15 text-brand border-brand/30" : "bg-secondary text-muted-foreground border-border"}`}>
                          {j.active ? "active" : "off"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {jr.length}{failedCount > 0 && <span className="text-destructive ml-1">({failedCount} failed)</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {last ? (
                          <span className={last.status === "succeeded" ? "text-foreground" : "text-destructive"}>
                            {last.status}{last.duration_ms != null && ` · ${Math.round(last.duration_ms)}ms`}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {last ? new Date(last.start_time).toLocaleString() : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">Recent runs (last 6h)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.slice(0, 50).map((r, i) => {
                  const j = jobs.find(x => x.jobid === r.jobid);
                  const ok = r.status === "succeeded";
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-xs">
                        <span className="font-mono">#{r.jobid}</span>{j ? ` ${j.jobname}` : ""}
                      </TableCell>
                      <TableCell className={`text-xs ${ok ? "" : "text-destructive font-medium"}`}>{r.status}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(r.start_time).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{r.duration_ms != null ? `${Math.round(r.duration_ms)}ms` : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[280px]">{r.return_message ?? ""}</TableCell>
                    </TableRow>
                  );
                })}
                {runs.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-xs text-muted-foreground text-center py-6">No runs in the last 6 hours.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "warn" | "danger" }) {
  const c = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-brand" : "text-foreground";
  return (
    <div className="p-3 rounded-lg border border-border bg-card">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${c}`}>{value}</div>
    </div>
  );
}
