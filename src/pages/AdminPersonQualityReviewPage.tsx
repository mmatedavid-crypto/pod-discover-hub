import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useNoindex } from "@/lib/useNoindex";
import { useAdminAccess } from "@/hooks/useAdminAccess";

export default function AdminPersonQualityReviewPage() {
  useNoindex("Person Quality Review — Admin");
  const { loading: adminLoading, isAdmin } = useAdminAccess();
  const [summary, setSummary] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string>("");

  const load = async () => {
    const [{ data: s }, { data: r }] = await Promise.all([
      supabase.from("person_ai_review_summary_view").select("*").maybeSingle(),
      supabase.from("person_ai_action_queue_view").select("*").limit(100),
    ]);
    setSummary(s); setRows(r || []);
  };
  useEffect(() => {
    if (adminLoading || !isAdmin) return;
    load();
  }, [adminLoading, isAdmin]);

  const runReview = async (limit: number) => {
    if (!isAdmin) return;
    setRunning(true); setLog("Futtatás…");
    const { data, error } = await supabase.functions.invoke("person-ai-reviewer", { body: { limit } });
    setLog(error ? String(error.message) : JSON.stringify(data, null, 2));
    setRunning(false); load();
  };

  const refreshActivation = async () => {
    if (!isAdmin) return;
    setRunning(true); setLog("Recompute activation…");
    const { data, error } = await supabase.rpc("refresh_person_activation_status");
    setLog(error ? String(error.message) : JSON.stringify(data, null, 2));
    setRunning(false); load();
  };

  if (adminLoading) return <Layout><div className="container mx-auto py-20">Betöltés…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Nincs jogosultság.</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto py-8 space-y-6 max-w-6xl">
        <h1 className="text-2xl font-semibold">Person Quality Review</h1>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(summary).map(([k, v]) => (
              <div key={k} className="p-3 rounded-lg border border-border bg-card">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</div>
                <div className="text-xl font-semibold mt-1">{String(v)}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button disabled={running} onClick={refreshActivation} className="px-3 py-2 rounded-md border border-border bg-card text-sm">
            Refresh activation
          </button>
          <button disabled={running} onClick={() => runReview(20)} className="px-3 py-2 rounded-md border border-border bg-card text-sm">
            Review 20
          </button>
          <button disabled={running} onClick={() => runReview(50)} className="px-3 py-2 rounded-md border border-border bg-card text-sm">
            Review 50
          </button>
        </div>

        {log && <pre className="text-xs bg-card border border-border rounded-md p-3 max-h-64 overflow-auto">{log}</pre>}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-xs">
            <thead className="bg-secondary text-muted-foreground">
              <tr>
                {["name","slug","action","status","conf","score","flags","summary"].map(h => (
                  <th key={h} className="text-left px-2 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-2 py-1 font-medium">{r.name}</td>
                  <td className="px-2 py-1 text-muted-foreground">{r.slug}</td>
                  <td className="px-2 py-1">{r.ai_recommended_action}</td>
                  <td className="px-2 py-1">{r.activation_status} / {r.ai_review_status}</td>
                  <td className="px-2 py-1">{Number(r.ai_review_confidence || 0).toFixed(2)}</td>
                  <td className="px-2 py-1">—</td>
                  <td className="px-2 py-1 text-muted-foreground">{(r.ai_review_flags || []).join(", ")}</td>
                  <td className="px-2 py-1 max-w-md truncate" title={r.ai_review_summary}>{r.ai_review_summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
