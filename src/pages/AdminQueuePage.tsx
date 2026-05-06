import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { slugify } from "@/lib/slug";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

type ImportOutcome = {
  ok: boolean;
  status: string; // imported | skipped_duplicate | imported_with_rss_error | failed
  reason?: string;
  podcast_id?: string;
  insert?: any;
  fetch?: any;
};

async function importOneQueueItem(item: any): Promise<ImportOutcome> {
  const stamp = new Date().toISOString();
  const setQueue = async (patch: any) =>
    supabase.from("discovery_queue").update({ ...patch, last_import_attempt_at: stamp }).eq("id", item.id);

  await setQueue({ import_status: "importing", import_error: null });

  if (!item.rss_url) {
    await setQueue({ import_status: "failed", import_error: "missing rss_url", status: "rejected" });
    return { ok: false, status: "failed", reason: "missing rss_url" };
  }
  if (!item.title) {
    await setQueue({ import_status: "failed", import_error: "missing title", status: "rejected" });
    return { ok: false, status: "failed", reason: "missing title" };
  }

  // duplicate?
  const { data: dup, error: dupErr } = await supabase
    .from("podcasts").select("id").eq("rss_url", item.rss_url).maybeSingle();
  if (dupErr) {
    await setQueue({ import_status: "failed", import_error: `duplicate check failed: ${dupErr.message}` });
    return { ok: false, status: "failed", reason: `duplicate check failed: ${dupErr.message}` };
  }
  if (dup) {
    await setQueue({
      import_status: "skipped_duplicate",
      import_error: "duplicate rss_url",
      status: "approved",
      imported_podcast_id: dup.id,
    });
    return { ok: false, status: "skipped_duplicate", reason: "duplicate rss_url", podcast_id: dup.id };
  }

  // unique slug
  let slug = slugify(item.title);
  for (let a = 0; a < 6; a++) {
    const { data: ds } = await supabase.from("podcasts").select("id").eq("slug", slug).maybeSingle();
    if (!ds) break;
    slug = `${slugify(item.title)}-${a + 1}`;
  }

  const rankLabel = item.candidate_rank >= 8 ? "Excellent" : item.candidate_rank >= 6 ? "Strong" : "Indexed";

  const { data: inserted, error: insErr } = await supabase.from("podcasts").insert({
    title: item.title, slug,
    description: item.description, rss_url: item.rss_url,
    website_url: item.website_url, image_url: item.image_url,
    language: item.language || "en", category: item.category,
    source: item.source || "queue_bulk_import",
    rss_status: "not_checked",
    podiverzum_rank: item.candidate_rank,
    rank_label: rankLabel,
    rank_reason: item.rank_reason,
  }).select("id").single();

  if (insErr || !inserted) {
    const msg = insErr?.message || "unknown insert error";
    const reason = /row-level security|permission/i.test(msg)
      ? `permission/RLS: ${msg}`
      : /duplicate key|unique/i.test(msg)
        ? `slug conflict / duplicate: ${msg}`
        : `insert failed: ${msg}`;
    await setQueue({ import_status: "failed", import_error: reason });
    return { ok: false, status: "failed", reason, insert: insErr };
  }

  // fetch RSS
  const epCap = item.candidate_rank >= 8 ? 75 : item.candidate_rank >= 6 ? 50 : 30;
  let fetchRes: any = null;
  let fetchErr: string | null = null;
  try {
    const { data, error } = await supabase.functions.invoke("fetch-rss", {
      body: { podcast_id: inserted.id, episode_cap: epCap },
    });
    if (error) fetchErr = `function invocation error: ${error.message}`;
    fetchRes = data;
  } catch (e: any) {
    fetchErr = `function threw: ${e?.message || String(e)}`;
  }

  if (fetchErr || !fetchRes || fetchRes.ok === false || fetchRes.error) {
    const reason = fetchErr
      || (fetchRes?.error ? `fetch-rss failed: ${fetchRes.error}` : "fetch-rss returned failed status");
    await setQueue({
      import_status: "imported_with_rss_error",
      import_error: reason,
      status: "approved",
      imported_podcast_id: inserted.id,
      imported_at: new Date().toISOString(),
    });
    return { ok: true, status: "imported_with_rss_error", reason, podcast_id: inserted.id, fetch: fetchRes };
  }

  if ((fetchRes.new ?? 0) === 0 && (fetchRes.duplicates ?? 0) === 0) {
    await setQueue({
      import_status: "imported_with_rss_error",
      import_error: "no episodes imported",
      status: "approved",
      imported_podcast_id: inserted.id,
      imported_at: new Date().toISOString(),
    });
    return { ok: true, status: "imported_with_rss_error", reason: "no episodes imported", podcast_id: inserted.id, fetch: fetchRes };
  }

  await setQueue({
    import_status: "imported",
    import_error: null,
    status: "approved",
    imported_podcast_id: inserted.id,
    imported_at: new Date().toISOString(),
  });
  return { ok: true, status: "imported", podcast_id: inserted.id, fetch: fetchRes };
}

function classifyReason(r?: string): string {
  if (!r) return "unknown";
  const s = r.toLowerCase();
  if (s.includes("duplicate")) return "duplicate";
  if (s.includes("permission") || s.includes("rls")) return "permission/RLS";
  if (s.includes("insert failed") || s.includes("slug conflict")) return "insert failed";
  if (s.includes("no episodes")) return "no episodes";
  if (s.includes("fetch-rss") || s.includes("function invocation") || s.includes("function threw")) return "fetch failed";
  if (s.includes("missing")) return "missing field";
  return "unknown";
}

export default function AdminQueuePage() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ ok: number; failed: number; skipped: number; rss_err: number } | null>(null);
  const [failureSummary, setFailureSummary] = useState<Record<string, number>>({});
  const [diagResults, setDiagResults] = useState<Array<{ item: any; outcome: ImportOutcome }>>([]);
  const [testBusy, setTestBusy] = useState(false);

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
    // failure summary across recent failed/error items (any status)
    const { data: failed } = await supabase
      .from("discovery_queue").select("import_status,import_error")
      .in("import_status", ["failed", "imported_with_rss_error", "skipped_duplicate"])
      .limit(2000);
    const sum: Record<string, number> = {};
    (failed || []).forEach((r: any) => {
      const key = r.import_status === "skipped_duplicate" ? "duplicate" : classifyReason(r.import_error);
      sum[key] = (sum[key] || 0) + 1;
    });
    setFailureSummary(sum);
  };

  const approve = async (item: any) => {
    setBusy(item.id);
    try {
      const res = await importOneQueueItem(item);
      if (res.ok && res.status === "imported") toast.success("Approved & added");
      else toast.error(`${res.status}: ${res.reason || "see details"}`);
      await load();
    } finally { setBusy(null); }
  };

  const testFirst5 = async () => {
    setTestBusy(true);
    setDiagResults([]);
    try {
      const { data: candidates } = await supabase
        .from("discovery_queue").select("*")
        .eq("status", "pending").gte("candidate_rank", 4)
        .order("candidate_rank", { ascending: false }).limit(5);
      const results: Array<{ item: any; outcome: ImportOutcome }> = [];
      for (const it of (candidates || [])) {
        const outcome = await importOneQueueItem(it);
        results.push({ item: it, outcome });
        setDiagResults([...results]);
      }
      toast.success(`Tested ${results.length} items`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "test failed");
    } finally { setTestBusy(false); }
  };

  const bulkImportRank4Plus = async () => {
    if (!confirm("Import all technically valid Rank ≥ 4 queued podcasts?")) return;
    setBulkBusy(true);
    let ok = 0, failed = 0, skipped = 0, rss_err = 0;
    setBulkProgress({ ok, failed, skipped, rss_err });
    try {
      const { data: candidates } = await supabase
        .from("discovery_queue").select("*")
        .eq("status", "pending").gte("candidate_rank", 4)
        .order("candidate_rank", { ascending: false }).limit(2000);
      const list = candidates || [];
      const BATCH = 5;
      for (let i = 0; i < list.length; i += BATCH) {
        const chunk = list.slice(i, i + BATCH);
        await Promise.all(chunk.map(async (item: any) => {
          const r = await importOneQueueItem(item);
          if (r.status === "imported") ok++;
          else if (r.status === "skipped_duplicate") skipped++;
          else if (r.status === "imported_with_rss_error") rss_err++;
          else failed++;
        }));
        setBulkProgress({ ok, failed, skipped, rss_err });
      }
      toast.success(`Bulk: +${ok} imported, ${rss_err} rss-error, ${skipped} dup, ${failed} failed`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "bulk import failed");
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
            <Button onClick={bulkImportRank4Plus} disabled={bulkBusy}>
              {bulkBusy ? `Importing… (+${bulkProgress?.ok ?? 0})` : "Import all valid Rank ≥ 4"}
            </Button>
            <Button asChild variant="outline"><Link to="/admin/growth">Growth Dashboard</Link></Button>
          </div>
        </div>

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

        {bulkProgress && (
          <p className="text-xs text-muted-foreground">
            Progress: +{bulkProgress.ok} imported · {bulkProgress.rss_err} rss-error · {bulkProgress.skipped} duplicate · {bulkProgress.failed} failed
          </p>
        )}

        {diagResults.length > 0 && (
          <Card><CardContent className="p-4 space-y-3">
            <div className="text-sm font-medium">Diagnostic test results</div>
            {diagResults.map(({ item, outcome }, i) => (
              <div key={i} className="text-xs border-l-2 border-muted pl-3 space-y-1">
                <div className="font-medium">{item.title} <span className="text-muted-foreground">(Rank {item.candidate_rank})</span></div>
                <div className="text-muted-foreground truncate">{item.rss_url}</div>
                <div>Status: <span className={outcome.ok ? "text-primary" : "text-destructive"}>{outcome.status}</span></div>
                {outcome.reason && <div className="text-destructive">Reason: {outcome.reason}</div>}
                {outcome.fetch && <div className="text-muted-foreground">fetch-rss: new={outcome.fetch.new ?? "?"} dup={outcome.fetch.duplicates ?? "?"} items={outcome.fetch.items ?? "?"}{outcome.fetch.error ? ` err=${outcome.fetch.error}` : ""}</div>}
                {outcome.podcast_id && <div className="text-muted-foreground">podcast_id: {outcome.podcast_id}</div>}
              </div>
            ))}
          </CardContent></Card>
        )}

        <p className="text-xs text-muted-foreground">
          Bulk import adds Rank ≥ 4 podcasts. Rank 4–5 indexed only; Rank ≥ 6 promotion-eligible. Episode caps: Rank 8+ → 75, Rank 6–7 → 50, Rank 4–5 → 30.
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
