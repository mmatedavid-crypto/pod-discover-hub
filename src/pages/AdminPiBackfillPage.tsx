import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { setSeo } from "@/lib/seo";
import { toast } from "@/hooks/use-toast";
import { useAdminAccess } from "@/hooks/useAdminAccess";

type Row = {
  id: string;
  title: string;
  rank_label: string | null;
  language_decision: string | null;
  podiverzum_rank: number | null;
  pi_backfill_approved: boolean | null;
  pi_backfill_completed_at: string | null;
  pi_backfill_peeked_at: string | null;
  pi_backfill_dry_run: any;
  hydrated_episode_count: number | null;
};

const FN_URL = (name: string) => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;

async function callFn(name: string, body: any) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const r = await fetch(FN_URL(name), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return r.json();
}

export default function AdminPiBackfillPage() {
  const { loading: adminLoading, isAdmin } = useAdminAccess();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tier, setTier] = useState<"B" | "C" | "BC">("BC");
  const [minNew, setMinNew] = useState(20);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    setSeo({ title: "PI Backfill | Admin | Podiverzum", description: "PodcastIndex episode backfill review", noindex: true });
  }, []);

  const refresh = async () => {
    if (!isAdmin) return;
    setLoading(true);
    const tiers = tier === "BC" ? ["B", "C"] : [tier];
    const { data } = await supabase
      .from("podcasts")
      .select("id,title,rank_label,language_decision,podiverzum_rank,pi_backfill_approved,pi_backfill_completed_at,pi_backfill_peeked_at,pi_backfill_dry_run,hydrated_episode_count")
      .eq("language_decision", "accept_hungarian")
      .eq("rss_status", "active")
      .is("pi_backfill_completed_at", null)
      .in("rank_label", tiers)
      .order("podiverzum_rank", { ascending: false, nullsFirst: false })
      .limit(500);
    setRows((data as Row[]) || []);

    // Statisztika: hány S/A automata, hány B/C peek-elt, jóváhagyott
    const { count: saCount } = await supabase.from("podcasts").select("id", { count: "exact", head: true })
      .eq("language_decision", "accept_hungarian").eq("rss_status", "active").is("pi_backfill_completed_at", null).in("rank_label", ["S", "A"]);
    const { count: bcTotal } = await supabase.from("podcasts").select("id", { count: "exact", head: true })
      .eq("language_decision", "accept_hungarian").eq("rss_status", "active").is("pi_backfill_completed_at", null).in("rank_label", ["B", "C"]);
    const { count: bcPeeked } = await supabase.from("podcasts").select("id", { count: "exact", head: true })
      .eq("language_decision", "accept_hungarian").eq("rss_status", "active").is("pi_backfill_completed_at", null).in("rank_label", ["B", "C"])
      .not("pi_backfill_peeked_at", "is", null);
    const { count: bcApproved } = await supabase.from("podcasts").select("id", { count: "exact", head: true })
      .eq("language_decision", "accept_hungarian").eq("rss_status", "active").is("pi_backfill_completed_at", null).in("rank_label", ["B", "C"])
      .eq("pi_backfill_approved", true);
    setStats({ saCount, bcTotal, bcPeeked, bcApproved });
    setLoading(false);
  };

  useEffect(() => {
    if (adminLoading || !isAdmin) return;
    refresh();
  }, [adminLoading, isAdmin, tier]);

  const runPeek = async () => {
    if (!isAdmin) return;
    setBusy(true);
    const r = await callFn("pi-backfill-peek", { limit: 20, tier_filter: tier === "BC" ? ["B", "C"] : [tier] });
    toast({ title: "Peek", description: `processed=${r.processed} new=${r.total_new} dup=${r.total_dup} remaining=${r.remaining_to_peek}` });
    await refresh();
    setBusy(false);
  };

  const setApproval = async (id: string, approved: boolean) => {
    if (!isAdmin) return;
    await supabase.from("podcasts").update({ pi_backfill_approved: approved }).eq("id", id);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, pi_backfill_approved: approved } : r)));
  };

  const bulkApprove = async () => {
    if (!isAdmin) return;
    const ids = rows.filter((r) => (r.pi_backfill_dry_run?.new ?? 0) >= minNew && r.pi_backfill_approved !== true).map((r) => r.id);
    if (ids.length === 0) return toast({ title: "Nincs kiválasztható" });
    setBusy(true);
    await supabase.from("podcasts").update({ pi_backfill_approved: true }).in("id", ids);
    toast({ title: `Jóváhagyva ${ids.length} podcast (≥${minNew} új ep.)` });
    await refresh();
    setBusy(false);
  };

  const bulkReject = async () => {
    if (!isAdmin) return;
    const ids = rows.filter((r) => (r.pi_backfill_dry_run?.new ?? 0) < minNew && r.pi_backfill_peeked_at && r.pi_backfill_approved !== false).map((r) => r.id);
    if (ids.length === 0) return toast({ title: "Nincs elutasítható" });
    setBusy(true);
    await supabase.from("podcasts").update({ pi_backfill_approved: false }).in("id", ids);
    toast({ title: `Elutasítva ${ids.length} podcast (<${minNew} új ep.)` });
    await refresh();
    setBusy(false);
  };

  const runBackfill = async () => {
    if (!isAdmin) return;
    setBusy(true);
    const r = await callFn("pi-episode-backfill", { limit: 10 });
    toast({ title: "Backfill", description: `processed=${r.processed} new=${r.new_episodes} remaining=${r.remaining}` });
    await refresh();
    setBusy(false);
  };

  if (adminLoading) return <Layout><div className="container mx-auto py-20">Betöltés…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Nincs jogosultság.</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">PodcastIndex Episode Backfill</h1>
          <p className="text-sm text-muted-foreground mt-1">
            S/A tier automatikusan megy. B/C tier admin-jóváhagyás után fut a backfill.
          </p>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="border rounded p-3"><div className="text-muted-foreground">S/A automata</div><div className="text-2xl font-semibold">{stats.saCount}</div></div>
            <div className="border rounded p-3"><div className="text-muted-foreground">B/C összes</div><div className="text-2xl font-semibold">{stats.bcTotal}</div></div>
            <div className="border rounded p-3"><div className="text-muted-foreground">B/C peek-elt</div><div className="text-2xl font-semibold">{stats.bcPeeked}</div></div>
            <div className="border rounded p-3"><div className="text-muted-foreground">B/C jóváhagyott</div><div className="text-2xl font-semibold text-primary">{stats.bcApproved}</div></div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center border-y py-3">
          <select value={tier} onChange={(e) => setTier(e.target.value as any)} className="border rounded px-2 py-1 text-sm bg-background">
            <option value="BC">B+C tier</option>
            <option value="B">B tier</option>
            <option value="C">C tier</option>
          </select>
          <Button onClick={runPeek} disabled={busy} size="sm">Peek 20 podcastet</Button>
          <span className="mx-2 text-sm text-muted-foreground">Min új ep.:</span>
          <Input type="number" value={minNew} onChange={(e) => setMinNew(Number(e.target.value))} className="w-20 h-8" />
          <Button onClick={bulkApprove} disabled={busy} size="sm" variant="default">Bulk approve ≥{minNew}</Button>
          <Button onClick={bulkReject} disabled={busy} size="sm" variant="outline">Bulk reject &lt;{minNew}</Button>
          <div className="flex-1" />
          <Button onClick={runBackfill} disabled={busy} size="sm" variant="secondary">Run backfill (10)</Button>
          <Button onClick={refresh} disabled={busy} size="sm" variant="ghost">Refresh</Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2">Approve</th>
                <th className="text-left p-2">Tier</th>
                <th className="text-left p-2">Rank</th>
                <th className="text-left p-2">Title</th>
                <th className="text-right p-2">Loaded</th>
                <th className="text-right p-2">PI items</th>
                <th className="text-right p-2 text-primary">+New</th>
                <th className="text-right p-2">Dup</th>
                <th className="text-left p-2">Peek</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">Nincs találat</td></tr>
              ) : rows.map((r) => {
                const dr = r.pi_backfill_dry_run || {};
                const newCount = dr.new ?? null;
                return (
                  <tr key={r.id} className="border-b hover:bg-muted/30">
                    <td className="p-2">
                      <Checkbox
                        checked={r.pi_backfill_approved === true}
                        onCheckedChange={(v) => setApproval(r.id, !!v)}
                      />
                    </td>
                    <td className="p-2"><span className="font-mono">{r.rank_label}</span></td>
                    <td className="p-2 font-mono text-xs">{r.podiverzum_rank?.toFixed(2)}</td>
                    <td className="p-2 max-w-md truncate">{r.title}</td>
                    <td className="p-2 text-right">{r.hydrated_episode_count ?? 0}</td>
                    <td className="p-2 text-right">{dr.items ?? "—"}</td>
                    <td className={`p-2 text-right font-semibold ${newCount && newCount >= minNew ? "text-primary" : ""}`}>
                      {newCount ?? "—"}
                    </td>
                    <td className="p-2 text-right text-muted-foreground">{dr.dup ?? "—"}</td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {r.pi_backfill_peeked_at ? new Date(r.pi_backfill_peeked_at).toLocaleString("hu-HU") : (dr.error ? `err: ${dr.error}` : "—")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
