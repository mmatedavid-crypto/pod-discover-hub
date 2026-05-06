import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useNoindex } from "@/lib/useNoindex";

type Row = {
  id: string;
  query: string;
  terms_count: number;
  result_count: number;
  fallback_used: boolean;
  created_at: string;
};

export default function AdminSearchInsightsPage() {
  useNoindex("Admin · Search insights — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [windowDays, setWindowDays] = useState<1 | 7 | 30>(7);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: uid, _role: "admin" });
      setIsAdmin(hasAdmin === true);
      if (hasAdmin === true) {
        const since = new Date(Date.now() - windowDays * 86400_000).toISOString();
        const { data: r } = await supabase
          .from("search_events")
          .select("id,query,terms_count,result_count,fallback_used,created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(5000);
        setRows((r as Row[]) || []);
      }
      setReady(true);
    })();
  }, [nav, windowDays]);

  const stats = useMemo(() => {
    const total = rows.length;
    const zero = rows.filter((r) => r.result_count === 0).length;
    const fallback = rows.filter((r) => r.fallback_used).length;
    const avg = total ? rows.reduce((s, r) => s + r.result_count, 0) / total : 0;

    const byQuery = new Map<string, { q: string; n: number; zero: number; avg: number; fallback: number }>();
    rows.forEach((r) => {
      const k = r.query.trim().toLowerCase();
      const cur = byQuery.get(k) || { q: r.query, n: 0, zero: 0, avg: 0, fallback: 0 };
      cur.n++;
      cur.avg += r.result_count;
      if (r.result_count === 0) cur.zero++;
      if (r.fallback_used) cur.fallback++;
      byQuery.set(k, cur);
    });
    const top = Array.from(byQuery.values()).map((x) => ({ ...x, avg: x.avg / x.n })).sort((a, b) => b.n - a.n);
    const zeroQueries = top.filter((x) => x.zero > 0).sort((a, b) => b.zero - a.zero);
    return { total, zero, fallback, avg, top, zeroQueries };
  }, [rows]);

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Not authorized.</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto py-10 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-3xl font-semibold">Search insights</h1>
          <div className="flex gap-2 text-xs">
            {([1, 7, 30] as const).map((d) => (
              <button key={d} onClick={() => setWindowDays(d)} className={`px-2.5 py-1 rounded-full border ${windowDays === d ? "bg-foreground text-background border-foreground" : "bg-card border-border"}`}>
                Last {d}d
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total searches" value={stats.total.toLocaleString()} />
          <Stat label="Zero-result" value={`${stats.zero} (${pct(stats.zero, stats.total)}%)`} />
          <Stat label="Fallback used" value={`${stats.fallback} (${pct(stats.fallback, stats.total)}%)`} />
          <Stat label="Avg results" value={stats.avg.toFixed(1)} />
        </div>

        <section>
          <h2 className="font-semibold mb-2">Top queries</h2>
          <Table rows={stats.top.slice(0, 50)} />
        </section>

        <section>
          <h2 className="font-semibold mb-2">Zero-result queries</h2>
          {stats.zeroQueries.length === 0 ? (
            <p className="text-sm text-muted-foreground">None — every query returned at least one result.</p>
          ) : (
            <Table rows={stats.zeroQueries.slice(0, 50)} />
          )}
        </section>
      </div>
    </Layout>
  );
}

function pct(a: number, b: number) { return b ? Math.round((a / b) * 100) : 0; }

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function Table({ rows }: { rows: { q: string; n: number; zero: number; avg: number; fallback: number }[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-secondary text-xs">
          <tr>
            <th className="text-left px-3 py-2">Query</th>
            <th className="text-right px-3 py-2">Searches</th>
            <th className="text-right px-3 py-2">Avg results</th>
            <th className="text-right px-3 py-2">Zero</th>
            <th className="text-right px-3 py-2">Fallback</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.q} className="border-t border-border">
              <td className="px-3 py-2"><a href={`/search?q=${encodeURIComponent(r.q)}`} className="hover:underline">{r.q}</a></td>
              <td className="px-3 py-2 text-right">{r.n}</td>
              <td className="px-3 py-2 text-right">{r.avg.toFixed(1)}</td>
              <td className="px-3 py-2 text-right">{r.zero}</td>
              <td className="px-3 py-2 text-right">{r.fallback}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
