// Admin Language Gate dashboard.
// Shows counters, ingestion-prevention metrics, foreign-language breakdown,
// recent cleanup log, and review queue with approve/reject actions.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

interface Counters {
  accepted: number;
  rejected_in_db: number;
  review_pending: number;
  hard_deleted: number;
  prevented_ai_jobs: number;
  prevented_embeddings: number;
}

interface ReviewRow {
  id: string;
  podcast_id: string;
  title: string | null;
  rss_url: string | null;
  detected_language: string | null;
  hungarian_score: number | null;
  foreign_score: number | null;
  reason: string | null;
  evidence: any;
  status: string;
  created_at: string;
}

interface CleanupRow {
  id: string;
  podcast_id: string | null;
  title: string | null;
  rss_url: string | null;
  detected_language: string | null;
  hungarian_score: number | null;
  foreign_score: number | null;
  deletion_reason: string | null;
  deleted_related_episode_count: number;
  deleted_embedding_count: number;
  deleted_ai_job_count: number;
  deleted_at: string;
}

export default function AdminLanguageGatePage() {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [counters, setCounters] = useState<Counters | null>(null);
  const [langBreakdown, setLangBreakdown] = useState<Record<string, number>>({});
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [cleanupRows, setCleanupRows] = useState<CleanupRow[]>([]);
  const [incidentMode, setIncidentMode] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate("/auth?next=/admin/language-gate"); return; }
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!hasAdmin) { setIsAdmin(false); return; }
      setIsAdmin(true);
      await loadAll();
    })();
  }, []);

  async function loadAll() {
    setLoading(true);
    const [pc, ld, rq, cl, st] = await Promise.all([
      supabase.from("podcasts").select("language_decision", { count: "exact", head: false }).limit(2000),
      supabase.from("podcasts").select("detected_language").not("language_decision", "eq", "accept_hungarian").limit(2000),
      supabase.from("podcast_language_review_queue").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(200),
      supabase.from("podcast_language_cleanup_log").select("*").order("deleted_at", { ascending: false }).limit(100),
      supabase.from("app_settings").select("value").eq("key", "background_jobs").maybeSingle(),
    ]);

    const decisions = ((pc.data || []) as any[]).reduce((m: Record<string, number>, r: any) => {
      const k = r.language_decision || "unset";
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});
    const breakdown = ((ld.data || []) as any[]).reduce((m: Record<string, number>, r: any) => {
      const k = r.detected_language || "unknown";
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});

    const cleanup = (cl.data || []) as CleanupRow[];
    const preventedJobs = cleanup.reduce((s, r) => s + (r.deleted_ai_job_count || 0), 0);
    const preventedEmb = cleanup.reduce((s, r) => s + (r.deleted_embedding_count || 0), 0);

    setCounters({
      accepted: decisions["accept_hungarian"] || 0,
      rejected_in_db: decisions["reject_foreign"] || 0,
      review_pending: decisions["review_uncertain"] || 0,
      hard_deleted: cleanup.filter((r) => r.podcast_id === null || (r.deleted_related_episode_count || 0) > 0 || true).length,
      prevented_ai_jobs: preventedJobs,
      prevented_embeddings: preventedEmb,
    });
    setLangBreakdown(breakdown);
    setReviewRows((rq.data || []) as ReviewRow[]);
    setCleanupRows(cleanup);
    setIncidentMode(((st.data as any)?.value?.incident_mode) === true);
    setLoading(false);
  }

  async function runAudit() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("language-audit-runner", {
        body: { dry_run: false, limit: 1000, only_unchecked: false, recheck_after_hours: 0 },
      });
      if (error) throw error;
      toast({ title: "Audit lefutott", description: `scanned=${(data as any)?.scanned}, reject=${(data as any)?.rejected_foreign}, review=${(data as any)?.review_uncertain}` });
      await loadAll();
    } catch (e: any) {
      toast({ title: "Audit hiba", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function runCleanup() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("language-cleanup-runner", { body: { dry_run: false, limit: 100 } });
      if (error) throw error;
      toast({ title: "Cleanup kész", description: `deleted=${(data as any)?.podcasts_deleted}, episodes=${(data as any)?.episodes_deleted}` });
      await loadAll();
    } catch (e: any) {
      toast({ title: "Cleanup hiba", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function approveRow(row: ReviewRow) {
    setBusy(true);
    try {
      await supabase.from("podcasts").update({
        is_hungarian: true,
        language_decision: "accept_hungarian",
        language_checked_at: new Date().toISOString(),
      }).eq("id", row.podcast_id);
      await supabase.from("podcast_language_review_queue").update({ status: "approved", reviewed_at: new Date().toISOString() }).eq("id", row.id);
      toast({ title: "Elfogadva mint magyar" });
      await loadAll();
    } catch (e: any) {
      toast({ title: "Hiba", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function rejectRow(row: ReviewRow) {
    setBusy(true);
    try {
      await supabase.from("podcasts").update({
        is_hungarian: false,
        language_decision: "reject_foreign",
        language_rejection_reason: "admin_manual_reject",
        language_checked_at: new Date().toISOString(),
      }).eq("id", row.podcast_id);
      await supabase.from("podcast_language_review_queue").update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("id", row.id);
      toast({ title: "Elutasítva — futtass cleanup-ot a teljes törléshez" });
      await loadAll();
    } catch (e: any) {
      toast({ title: "Hiba", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function resumeJobs() {
    if (!confirm("Biztos visszakapcsolod a háttérfeladatokat? Ellenőrizted hogy minden HU-only?")) return;
    setBusy(true);
    try {
      await supabase.from("app_settings").update({ value: { enabled: true, incident_mode: false }, updated_at: new Date().toISOString() }).eq("key", "background_jobs");
      toast({ title: "Háttérfeladatok visszakapcsolva" });
      setIncidentMode(false);
    } catch (e: any) {
      toast({ title: "Hiba", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  const langEntries = useMemo(() => Object.entries(langBreakdown).sort((a, b) => b[1] - a[1]), [langBreakdown]);

  if (isAdmin === false) return <Layout><div className="p-8">Nincs admin jogosultságod.</div></Layout>;
  if (loading || !counters) return <Layout><div className="p-8">Töltés…</div></Layout>;

  return (
    <Layout>
      <div className="max-w-6xl mx-auto p-6 space-y-8">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Nyelvi kapu / Language Gate</h1>
            <p className="text-sm text-muted-foreground">Magyar-only minőségbiztosítás</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={runAudit} disabled={busy}>Audit futtatása</Button>
            <Button size="sm" variant="outline" onClick={runCleanup} disabled={busy}>Cleanup futtatása</Button>
            {incidentMode ? (
              <Button size="sm" variant="destructive" onClick={resumeJobs} disabled={busy}>Háttérfeladatok visszakapcsolása</Button>
            ) : (
              <Badge variant="secondary">Háttérfeladatok aktívak</Badge>
            )}
          </div>
        </header>

        <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: "Elfogadott (magyar)", value: counters.accepted, tone: "default" as const },
            { label: "Elutasított (idegen)", value: counters.rejected_in_db, tone: "destructive" as const },
            { label: "Felülvizsgálatra vár", value: counters.review_pending, tone: "secondary" as const },
            { label: "Véglegesen törölt", value: cleanupRows.length, tone: "outline" as const },
            { label: "Megelőzött AI jobok", value: counters.prevented_ai_jobs, tone: "outline" as const },
            { label: "Megelőzött embeddingek", value: counters.prevented_embeddings, tone: "outline" as const },
          ].map((c) => (
            <div key={c.label} className="border rounded-lg p-4">
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className="text-2xl font-semibold tabular-nums">{c.value}</div>
            </div>
          ))}
        </section>

        <section>
          <h2 className="font-semibold mb-2">Idegen nyelv eloszlás (nem-accept podcastok)</h2>
          <div className="flex flex-wrap gap-2">
            {langEntries.map(([k, v]) => (
              <Badge key={k} variant="outline">{k}: {v}</Badge>
            ))}
            {langEntries.length === 0 && <span className="text-sm text-muted-foreground">Nincs adat.</span>}
          </div>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Felülvizsgálati sor ({reviewRows.length} pending)</h2>
          <div className="border rounded-lg divide-y">
            {reviewRows.map((r) => (
              <div key={r.id} className="p-3 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.title || "—"}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.rss_url}</div>
                  <div className="text-xs mt-1 flex gap-2 flex-wrap">
                    <Badge variant="outline">det: {r.detected_language || "?"}</Badge>
                    <Badge variant="outline">HU: {r.hungarian_score ?? "?"}</Badge>
                    <Badge variant="outline">FOR: {r.foreign_score ?? "?"}</Badge>
                    {r.reason && <Badge variant="secondary">{r.reason}</Badge>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approveRow(r)} disabled={busy}>Elfogad (HU)</Button>
                  <Button size="sm" variant="destructive" onClick={() => rejectRow(r)} disabled={busy}>Elutasít</Button>
                </div>
              </div>
            ))}
            {reviewRows.length === 0 && <div className="p-4 text-sm text-muted-foreground">Üres a sor.</div>}
          </div>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Cleanup log (utolsó {cleanupRows.length})</h2>
          <div className="border rounded-lg divide-y text-sm">
            {cleanupRows.slice(0, 50).map((r) => (
              <div key={r.id} className="p-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                <div className="md:col-span-2">
                  <div className="font-medium truncate">{r.title || "—"}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.rss_url || ""}</div>
                </div>
                <div className="text-xs">
                  <div>nyelv: {r.detected_language}</div>
                  <div>HU/FOR: {r.hungarian_score}/{r.foreign_score}</div>
                </div>
                <div className="text-xs">
                  <div>epizód: {r.deleted_related_episode_count}</div>
                  <div>emb: {r.deleted_embedding_count} · AI: {r.deleted_ai_job_count}</div>
                  <div className="text-muted-foreground">{new Date(r.deleted_at).toLocaleString()}</div>
                </div>
              </div>
            ))}
            {cleanupRows.length === 0 && <div className="p-4 text-muted-foreground">Üres.</div>}
          </div>
        </section>
      </div>
    </Layout>
  );
}
