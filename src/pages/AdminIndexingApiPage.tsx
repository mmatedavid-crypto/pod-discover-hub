import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { setSeo } from "@/lib/seo";
import { useAdminAccess } from "@/hooks/useAdminAccess";

type RunRow = {
  at: string;
  submitted: number;
  failed: number;
  total_candidates: number;
  quota_hit?: boolean;
  sample_errors?: { url: string; status: number; body?: string }[];
};
type State = {
  enabled?: boolean;
  last_run_at?: string;
  last_success_count?: number;
  last_failed_count?: number;
  quota_exceeded_until?: string | null;
  daily?: Record<string, number>;
  runs?: RunRow[];
};

export default function AdminIndexingApiPage() {
  const { isAdmin, loading } = useAdminAccess();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);

  useEffect(() => {
    setSeo({ title: "Google Indexing API — admin", description: "Indexing API submission state" });
  }, []);

  const load = async () => {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "indexing_api_state").maybeSingle();
    setState((data?.value as State) || {});
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setLastResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("google-indexing-submit", {
        body: { dry_run: dryRun, max: dryRun ? 20 : undefined },
      });
      if (error) throw error;
      setLastResult(data);
      toast.success(dryRun ? "Dry run kész" : `Beküldve: ${data?.submitted ?? 0}`);
      if (!dryRun) await load();
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Layout><div className="p-6">Betöltés…</div></Layout>;
  if (!isAdmin) return <Layout><div className="p-6">Nincs jogosultság.</div></Layout>;

  const dailyEntries = Object.entries(state?.daily || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const dailyTotal = dailyEntries.reduce((s, [, n]) => s + n, 0);

  return (
    <Layout>
      <div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
        <div>
          <Link to="/admin" className="text-xs text-muted-foreground hover:text-foreground">← Admin hub</Link>
          <h1 className="text-2xl font-semibold mt-2">Google Indexing API</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Napi automatikus URL-ping a Google felé. Limit: 200 URL/nap. Cron 92 napi 05:00 UTC.
          </p>
        </div>

        <section className="rounded-lg border border-border p-4 space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <div><span className="text-muted-foreground">Utolsó futás:</span> <span className="font-medium">{state?.last_run_at ? new Date(state.last_run_at).toLocaleString("hu-HU") : "—"}</span></div>
            <div><span className="text-muted-foreground">Sikeres:</span> <span className="font-medium">{state?.last_success_count ?? 0}</span></div>
            <div><span className="text-muted-foreground">Hibás:</span> <span className="font-medium">{state?.last_failed_count ?? 0}</span></div>
            {state?.quota_exceeded_until && new Date(state.quota_exceeded_until) > new Date() && (
              <div className="text-red-500">Kvóta kimerült: {new Date(state.quota_exceeded_until).toLocaleString("hu-HU")}</div>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            <Button size="sm" disabled={busy} onClick={() => run(true)} variant="outline">Dry run (20 URL)</Button>
            <Button size="sm" disabled={busy} onClick={() => run(false)}>Beküldés most</Button>
          </div>
        </section>

        <section className="rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold mb-2">Napi beküldések (30 nap, összesen: {dailyTotal})</h2>
          {dailyEntries.length === 0 ? (
            <div className="text-xs text-muted-foreground">Még nincs adat.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs font-mono">
              {dailyEntries.map(([date, n]) => (
                <div key={date} className="flex justify-between border-b border-border/40 py-0.5">
                  <span className="text-muted-foreground">{date}</span>
                  <span className="font-semibold tabular-nums">{n}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold mb-2">Utolsó 30 futás</h2>
          <div className="space-y-1 text-xs font-mono max-h-96 overflow-y-auto">
            {(state?.runs || []).slice().reverse().map((r, i) => (
              <div key={i} className="flex justify-between border-b border-border/40 py-0.5">
                <span className="text-muted-foreground">{new Date(r.at).toLocaleString("hu-HU")}</span>
                <span className="tabular-nums">✓ {r.submitted} / ✗ {r.failed} / {r.total_candidates} jelölt{r.quota_hit ? " · KVÓTA" : ""}</span>
              </div>
            ))}
          </div>
        </section>

        {lastResult && (
          <pre className="rounded-lg border border-border p-3 text-[11px] overflow-x-auto bg-muted/40">{JSON.stringify(lastResult, null, 2)}</pre>
        )}

        <section className="rounded-lg border border-border p-4 text-xs text-muted-foreground space-y-2">
          <div className="font-semibold text-foreground">Előfeltétel (egyszer):</div>
          <ol className="list-decimal pl-5 space-y-1">
            <li>GSC → Settings → Users and permissions → Add user</li>
            <li>E-mail: <code className="bg-muted px-1">podiverzum@copper-diorama-496119-t3.iam.gserviceaccount.com</code></li>
            <li>Permission: <strong>Owner</strong> (kötelező)</li>
            <li>Google Cloud Console → APIs & Services → Library → engedélyezd: <strong>Indexing API</strong></li>
          </ol>
          <div>Limit: 200 URL/nap. Prioritás: új epizódok ≤24h → ≤7d nem indexelt → új podcastok/személyek.</div>
        </section>
      </div>
    </Layout>
  );
}
