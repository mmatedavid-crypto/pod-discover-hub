import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useNoindex } from "@/lib/useNoindex";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

type ItemResult = {
  title: string; rss_url: string; rank: number;
  status: string; reason?: string; podcast_id?: string;
  new_episodes?: number; duplicates?: number;
};

function classifyReason(r?: string): string {
  if (!r) return "unknown";
  const s = r.toLowerCase();
  if (s.includes("duplicate")) return "duplicate";
  if (s.includes("permission") || s.includes("rls")) return "permission/RLS";
  if (s.includes("insert failed") || s.includes("slug conflict")) return "insert failed";
  if (s.includes("no episodes")) return "no episodes";
  if (s.includes("rss fetch") || s.includes("fetch-rss") || s.includes("function")) return "fetch failed";
  if (s.includes("missing")) return "missing field";
  return "unknown";
}

export default function AdminQueuePage() {
  useNoindex("Admin · Queue — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [lastRun, setLastRun] = useState<any>(null);
  const [failureSummary, setFailureSummary] = useState<Record<string, number>>({});
  const [diagResults, setDiagResults] = useState<ItemResult[]>([]);
  const [testBusy, setTestBusy] = useState(false);
  const [drainer, setDrainer] = useState<any>(null);
  const [drainerBusy, setDrainerBusy] = useState(false);
  const [pendingR4, setPendingR4] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { nav("/auth"); return; }
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      const isAdmin = (roles || []).some((r: any) => r.role === "admin");
      setAllowed(isAdmin || user.id === TEMP_ADMIN_USER_ID);
      setReady(true);
      await load();
    })();
  }, []);

  const load = async () => {
    const { data } = await supabase.from("discovery_queue").select("*").eq("status", "pending").order("candidate_rank", { ascending: false });
    setItems(data || []);
    const { data: failed } = await supabase
      .from("discovery_queue").select("import_status,import_error")
      .in("import_status", ["failed", "imported_with_rss_error", "skipped_duplicate", "imported"])
      .limit(2000);
    const sum: Record<string, number> = {};
    (failed || []).forEach((r: any) => {
      let key: string;
      if (r.import_status === "imported") key = "imported";
      else if (r.import_status === "skipped_duplicate") key = "duplicate";
      else if (r.import_status === "imported_with_rss_error") key = "fetch failed";
      else key = classifyReason(r.import_error);
      sum[key] = (sum[key] || 0) + 1;
    });
    setFailureSummary(sum);
    const { data: status, error: statusErr } = await supabase.functions.invoke("queue-drainer-admin", { body: { action: "status" } });
    if (!statusErr && status?.ok) {
      setDrainer(status.setting || { enabled: false });
      setPendingR4(status.pending_rank4_plus || 0);
    } else {
      const { count: r4 } = await supabase
        .from("discovery_queue").select("*", { count: "exact", head: true })
        .eq("status", "pending").gte("candidate_rank", 4);
      setPendingR4(r4 || 0);
    }
  };

  const callAdmin = async (action: string) => {
    const { data, error } = await supabase.functions.invoke("queue-drainer-admin", { body: { action } });
    if (error) {
      const ctx: any = (error as any).context;
      let detail = error.message || "admin call failed";
      try {
        if (ctx?.body) {
          const txt = typeof ctx.body === "string" ? ctx.body : await new Response(ctx.body).text();
          if (txt) detail = `${detail}: ${txt.slice(0, 300)}`;
        }
      } catch { /* noop */ }
      throw new Error(detail);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const toggleDrainer = async (enabled: boolean) => {
    setDrainerBusy(true);
    try {
      await callAdmin(enabled ? "enable" : "disable");
      toast.success(enabled ? "Auto-drain enabled" : "Auto-drain disabled");
      await load();
    } catch (e: any) {
      toast.error(e.message || "failed");
    } finally { setDrainerBusy(false); }
  };

  const runDrainerNow = async () => {
    setDrainerBusy(true);
    try {
      const data = await callAdmin("run_now");
      const r = data?.run || {};
      toast.success(`Drainer: ${r.status || "ok"} · imported ${r.imported ?? 0} · remaining ${r.remaining ?? "?"}`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "drainer failed");
    } finally { setDrainerBusy(false); }
  };


  const callQueueImport = async (payload: any) => {
    const { data, error } = await supabase.functions.invoke("queue-import", { body: payload });
    if (error) throw new Error(error.message);
    if (!data?.ok) throw new Error(data?.error || "queue-import failed");
    return data;
  };

  const approve = async (item: any) => {
    setBusy(item.id);
    try {
      const data = await callQueueImport({ ids: [item.id], limit: 1 });
      const r: ItemResult = data.per_item_results?.[0];
      if (r?.status === "imported") toast.success("Approved & added");
      else toast.error(`${r?.status || "failed"}: ${r?.reason || "see details"}`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "import failed");
    } finally { setBusy(null); }
  };

  const testFirst5 = async () => {
    setTestBusy(true);
    setDiagResults([]);
    try {
      const data = await callQueueImport({ limit: 5, min_rank: 4 });
      setDiagResults(data.per_item_results || []);
      toast.success(`Tested ${data.processed} items`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "test failed");
    } finally { setTestBusy(false); }
  };

  const runBatch = async (size: number) => {
    setBulkBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("queue-import-runner", {
        body: { min_rank: 4, batch_size: size, max_batches: 1, time_budget_ms: 105000 },
      });
      if (error) {
        const ctx: any = (error as any).context;
        let detail = error.message || "runner failed";
        try {
          if (ctx?.body) {
            const txt = typeof ctx.body === "string" ? ctx.body : await new Response(ctx.body).text();
            if (txt) detail = `${detail}: ${txt.slice(0, 300)}`;
          }
        } catch { /* noop */ }
        throw new Error(detail);
      }
      if (!data?.ok) throw new Error(data?.error || "runner failed");
      setLastRun(data);
      toast.success(`+${data.imported} imported, ${data.imported_with_rss_error} rss-err, ${data.skipped_duplicate} dup, ${data.failed} failed${data.remaining_pending_rank4_plus ? ` · ${data.remaining_pending_rank4_plus} remaining` : ""}`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "batch import failed");
    } finally { setBulkBusy(false); }
  };

  const reject = async (id: string) => {
    setBusy(id);
    await supabase.from("discovery_queue").update({ status: "rejected" }).eq("id", id);
    setBusy(null);
    await load();
  };

  if (!ready) return <Layout><div className="container py-8">Loading…</div></Layout>;
  if (!allowed) return <Layout><div className="container py-8">Admin access required.</div></Layout>;

  return (
    <Layout>
      <div className="container py-6 space-y-4 max-w-5xl">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-2xl font-semibold">Approval Queue ({items.length})</h1>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={testFirst5} disabled={testBusy} variant="secondary">
              {testBusy ? "Testing…" : "Test import first 5"}
            </Button>
            <Button onClick={() => runBatch(10)} disabled={bulkBusy}>
              {bulkBusy ? "Importing…" : "Import next 10 Rank ≥ 4"}
            </Button>
            <Button onClick={() => runBatch(25)} disabled={bulkBusy} variant="outline">
              Import next 25 Rank ≥ 4
            </Button>
            <Button onClick={runLangVerify} disabled={langBusy} variant="outline">
              {langBusy ? "Verifying…" : "Purge non-HU (AI)"}
            </Button>
            <Button asChild variant="outline"><Link to="/admin/growth">Growth Dashboard</Link></Button>
          </div>
        </div>

        <Card><CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-sm font-medium">Auto-drain Rank ≥ 4 queue</div>
              <div className="text-xs text-muted-foreground">
                Status: {drainer?.enabled ? "ENABLED" : "DISABLED"} · pending Rank ≥ 4: {pendingR4} · runs every 10 min via scheduled job
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {drainer?.enabled ? (
                <Button size="sm" variant="outline" onClick={() => toggleDrainer(false)} disabled={drainerBusy}>Disable auto-drain</Button>
              ) : (
                <Button size="sm" onClick={() => toggleDrainer(true)} disabled={drainerBusy}>Enable auto-drain</Button>
              )}
              <Button size="sm" variant="secondary" onClick={runDrainerNow} disabled={drainerBusy}>Run drainer now</Button>
            </div>
          </div>
          {drainer?.last_run && (
            <div className="text-xs text-muted-foreground border-t pt-2">
              Last drainer run: {new Date(drainer.last_run.finished_at).toLocaleString()} · processed: {drainer.last_run.processed} · imported: {drainer.last_run.imported} · rss-err: {drainer.last_run.imported_with_rss_error} · dup: {drainer.last_run.skipped_duplicate} · failed: {drainer.last_run.failed} · remaining: {drainer.last_run.remaining} · stopped: {drainer.last_run.stopped_reason}
            </div>
          )}
          {drainer?.lock_until && new Date(drainer.lock_until).getTime() > Date.now() && (
            <div className="text-xs text-primary">A drainer run is currently in progress.</div>
          )}
        </CardContent></Card>


        {Object.keys(failureSummary).length > 0 && (
          <Card><CardContent className="p-4">
            <div className="text-sm font-medium mb-2">Past import outcomes</div>
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(failureSummary).map(([k, v]) => (
                <span key={k} className="px-2 py-1 rounded bg-muted">{k}: {v}</span>
              ))}
            </div>
          </CardContent></Card>
        )}


        {lastRun && (
          <Card><CardContent className="p-4 space-y-2">
            <div className="text-sm font-medium">Last bulk run</div>
            <div className="text-xs text-muted-foreground">
              processed: {lastRun.processed} · imported: {lastRun.imported} · rss-error: {lastRun.imported_with_rss_error} · duplicate: {lastRun.skipped_duplicate} · failed: {lastRun.failed}
            </div>
            <div className="text-xs text-muted-foreground">
              batches: {lastRun.batches_run} · elapsed: {Math.round((lastRun.elapsed_ms || 0) / 1000)}s · stopped: {lastRun.stopped_reason} · remaining Rank ≥ 4: {lastRun.remaining_pending_rank4_plus}
            </div>
            {lastRun.stopped_reason === "time_budget" && (
              <div className="text-xs text-primary">Batch completed. Click again to continue.</div>
            )}
          </CardContent></Card>
        )}

        {diagResults.length > 0 && (
          <Card><CardContent className="p-4 space-y-3">
            <div className="text-sm font-medium">Diagnostic test results</div>
            {diagResults.map((r, i) => (
              <div key={i} className="text-xs border-l-2 border-muted pl-3 space-y-1">
                <div className="font-medium">{r.title} <span className="text-muted-foreground">(Rank {r.rank})</span></div>
                <div className="text-muted-foreground truncate">{r.rss_url}</div>
                <div>Status: <span className={r.status === "imported" ? "text-primary" : "text-destructive"}>{r.status}</span></div>
                {r.reason && <div className="text-destructive">Reason: {r.reason}</div>}
                {typeof r.new_episodes === "number" && <div className="text-muted-foreground">episodes: new={r.new_episodes} dup={r.duplicates}</div>}
                {r.podcast_id && <div className="text-muted-foreground">podcast_id: {r.podcast_id}</div>}
              </div>
            ))}
          </CardContent></Card>
        )}

        <p className="text-xs text-muted-foreground">
          Bulk import (server-side, service role) adds Rank ≥ 4 podcasts. Rank 4–5 indexed only; Rank ≥ 6 promotion-eligible. Episode caps: Rank 8+ → 75, Rank 6–7 → 50, Rank 4–5 → 30.
        </p>

        {items.length === 0 && <p className="text-sm text-muted-foreground">No pending candidates.</p>}
        <div className="grid gap-3">
          {items.map((it) => (
            <Card key={it.id}>
              <CardContent className="p-4 flex gap-3 items-start">
                {it.image_url && <img src={it.image_url} alt="" className="w-16 h-16 rounded object-cover" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-medium truncate">{it.title}</div>
                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">Rank {it.candidate_rank}</span>
                    {it.language && <span className="text-xs text-muted-foreground">{it.language}</span>}
                    {it.category && <span className="text-xs text-muted-foreground">· {it.category}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{it.description}</div>
                  <div className="text-xs text-muted-foreground mt-1 truncate">{it.rss_url}</div>
                  {it.import_error && (
                    <div className="text-xs text-destructive mt-1">Failed: {it.import_error}</div>
                  )}
                  {it.import_status && !it.import_error && (
                    <div className="text-xs text-muted-foreground mt-1">Status: {it.import_status}</div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Button size="sm" onClick={() => approve(it)} disabled={busy === it.id}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => reject(it.id)} disabled={busy === it.id}>Reject</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}
