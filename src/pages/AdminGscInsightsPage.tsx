import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { useNoindex } from "@/lib/useNoindex";
import { ArrowLeft, RefreshCw, Sparkles, TrendingDown, TrendingUp } from "lucide-react";

type Insight = {
  id: string;
  week_start: string;
  week_end: string;
  totals: any;
  deltas: any;
  top_queries: any[];
  top_pages: any[];
  rising_queries: any[];
  falling_queries: any[];
  striking_distance: any[];
  zero_click_high_impr: any[];
  ai_summary: string | null;
  ai_recommendations: any[];
  ai_model: string | null;
  created_at: string;
};

const fmt = (n: number, d = 0) => n?.toLocaleString("hu-HU", { maximumFractionDigits: d }) ?? "—";
const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

export default function AdminGscInsightsPage() {
  useNoindex("GSC Insights — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Insight[]>([]);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("gsc_weekly_insights")
      .select("*")
      .order("week_start", { ascending: false })
      .limit(12);
    setRows((data || []) as any);
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      const { data: ok } = await supabase.rpc("has_role", { _user_id: uid, _role: "admin" });
      if (!ok) { nav("/"); return; }
      await load();
      setReady(true);
    })();
  }, [nav]);

  const runNow = async () => {
    setRunning(true);
    setMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("gsc-weekly-insights", { body: {} });
      if (error) throw error;
      setMsg(`Frissítve: ${data?.week?.start} → ${data?.week?.end} · ${data?.ai_actions ?? 0} AI akció`);
      await load();
    } catch (e: any) {
      setMsg(`Hiba: ${e?.message || e}`);
    } finally {
      setRunning(false);
    }
  };

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;

  const latest = rows[0];

  return (
    <Layout>
      <div className="container mx-auto py-8 sm:py-10 max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="h-4 w-4" /> Admin Hub
            </Link>
            <h1 className="text-2xl sm:text-3xl font-semibold">GSC heti insight</h1>
          </div>
          <button
            onClick={runNow}
            disabled={running}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
            {running ? "Futás…" : "Heti futtatás most"}
          </button>
        </div>

        {msg && <div className="text-sm text-muted-foreground">{msg}</div>}

        {!latest && (
          <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            Még nincs adat. Kattints a „Heti futtatás most" gombra az első GSC szinkronhoz.
          </div>
        )}

        {latest && (
          <>
            <section className="rounded-lg border border-border bg-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Hét: {latest.week_start} → {latest.week_end}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Metric label="Kattintás" v={fmt(latest.totals?.clicks)} delta={pct(latest.deltas?.clicks_pct ?? 0)} good={(latest.deltas?.clicks_pct ?? 0) >= 0} />
                <Metric label="Impresszió" v={fmt(latest.totals?.impressions)} delta={pct(latest.deltas?.impressions_pct ?? 0)} good={(latest.deltas?.impressions_pct ?? 0) >= 0} />
                <Metric label="CTR" v={`${((latest.totals?.ctr ?? 0) * 100).toFixed(2)}%`} delta={`${((latest.deltas?.ctr_delta ?? 0) * 100).toFixed(2)}pp`} good={(latest.deltas?.ctr_delta ?? 0) >= 0} />
                <Metric label="Átlag pozíció" v={(latest.totals?.position ?? 0).toFixed(1)} delta={`${(latest.deltas?.position_delta ?? 0).toFixed(2)}`} good={(latest.deltas?.position_delta ?? 0) <= 0} />
              </div>
            </section>

            {latest.ai_summary && (
              <section className="rounded-lg border border-primary/30 bg-primary/5 p-5">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-primary mb-2">
                  <Sparkles className="h-3.5 w-3.5" /> AI összefoglaló
                </div>
                <p className="text-sm leading-relaxed">{latest.ai_summary}</p>
              </section>
            )}

            {latest.ai_recommendations?.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm uppercase tracking-wider text-muted-foreground">Javasolt optimalizációs lépések</h2>
                <ol className="space-y-2">
                  {latest.ai_recommendations.map((a, i) => (
                    <li key={i} className="rounded-md border border-border bg-card p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                          a.priority === "high" ? "bg-destructive/15 text-destructive border-destructive/30"
                            : a.priority === "medium" ? "bg-brand/15 text-brand border-brand/30"
                            : "bg-secondary border-border text-muted-foreground"
                        }`}>{a.priority}</span>
                        <span className="text-[11px] text-muted-foreground">{a.type}</span>
                        <span className="text-xs font-mono truncate">{a.target}</span>
                      </div>
                      <div className="text-sm">{a.action}</div>
                      {a.expected_impact && <div className="text-xs text-muted-foreground mt-1">Várt hatás: {a.expected_impact}</div>}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <QueryTable title="Striking distance (4-20. pozíció)" rows={latest.striking_distance} cols={["query", "impressions", "ctr", "position"]} />
              <QueryTable title="Zero-click magas impresszió" rows={latest.zero_click_high_impr} cols={["query", "impressions", "position"]} />
              <QueryTable title="Top emelkedők" rows={latest.rising_queries} cols={["query", "clicks", "delta_clicks", "position"]} icon={<TrendingUp className="h-4 w-4 text-emerald-500" />} />
              <QueryTable title="Top esők" rows={latest.falling_queries} cols={["query", "clicks", "delta_clicks", "position"]} icon={<TrendingDown className="h-4 w-4 text-destructive" />} />
              <QueryTable title="Top kérdések" rows={latest.top_queries} cols={["query", "clicks", "impressions", "ctr", "position"]} />
              <QueryTable title="Top oldalak" rows={latest.top_pages} cols={["page", "clicks", "impressions", "ctr", "position"]} />
            </div>
          </>
        )}

        {rows.length > 1 && (
          <section className="space-y-2">
            <h2 className="text-sm uppercase tracking-wider text-muted-foreground">Korábbi hetek</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr><th className="text-left p-2">Hét</th><th className="text-right p-2">Kattintás</th><th className="text-right p-2">Δ%</th><th className="text-right p-2">Impr.</th><th className="text-right p-2">CTR</th><th className="text-right p-2">Pozíció</th></tr>
                </thead>
                <tbody>
                  {rows.slice(1).map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="p-2">{r.week_start} → {r.week_end}</td>
                      <td className="p-2 text-right tabular-nums">{fmt(r.totals?.clicks)}</td>
                      <td className="p-2 text-right tabular-nums">{pct(r.deltas?.clicks_pct ?? 0)}</td>
                      <td className="p-2 text-right tabular-nums">{fmt(r.totals?.impressions)}</td>
                      <td className="p-2 text-right tabular-nums">{((r.totals?.ctr ?? 0) * 100).toFixed(2)}%</td>
                      <td className="p-2 text-right tabular-nums">{(r.totals?.position ?? 0).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}

function Metric({ label, v, delta, good }: { label: string; v: string; delta: string; good: boolean }) {
  return (
    <div className="p-3 rounded-md border border-border bg-background/40">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums mt-1">{v}</div>
      <div className={`text-xs ${good ? "text-emerald-500" : "text-destructive"} tabular-nums`}>{delta}</div>
    </div>
  );
}

function QueryTable({ title, rows, cols, icon }: { title: string; rows: any[]; cols: string[]; icon?: React.ReactNode }) {
  if (!rows?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3 text-sm font-semibold">{icon}{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>{cols.map((c) => <th key={c} className={`p-1.5 ${c === "query" || c === "page" ? "text-left" : "text-right"}`}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 15).map((r, i) => (
              <tr key={i} className="border-t border-border/60">
                {cols.map((c) => {
                  const v = r[c];
                  const isText = c === "query" || c === "page";
                  let out: string;
                  if (typeof v === "number") {
                    out = c === "ctr" ? `${(v * 100).toFixed(1)}%` : c === "position" ? v.toFixed(1) : fmt(v);
                  } else out = String(v ?? "");
                  return <td key={c} className={`p-1.5 ${isText ? "text-left max-w-[260px] truncate" : "text-right tabular-nums"}`} title={isText ? out : undefined}>{out}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
