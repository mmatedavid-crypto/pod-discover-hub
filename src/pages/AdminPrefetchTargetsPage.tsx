import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { useNoindex } from "@/lib/useNoindex";
import { ArrowLeft, RefreshCw, ExternalLink, TrendingUp, Search as SearchIcon, Flame } from "lucide-react";

type Row = {
  id: string;
  podcast_id: string;
  podcast_slug: string;
  podcast_title: string;
  rank_label: string | null;
  cadence_per_week: number;
  cadence_pattern: string | null;
  episodes_last_60d: number;
  gsc_impressions_28d: number;
  gsc_clicks_28d: number;
  gsc_avg_position: number | null;
  gsc_top_queries: Array<{ query: string; clicks: number; impressions: number; position: number; ctr: number }>;
  trend_related_queries: string[];
  trend_rising_queries: string[];
  gap_queries: string[];
  priority_score: number;
  suggested_actions: string[];
  last_computed_at: string;
};

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString("hu-HU");

export default function AdminPrefetchTargetsPage() {
  useNoindex("Prefetch Targets — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("prefetch_targets")
      .select("*")
      .order("priority_score", { ascending: false })
      .limit(50);
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

  const runNow = async (opts: { skipTrends?: boolean; skipGsc?: boolean } = {}) => {
    setRunning(true);
    setMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("compute-prefetch-targets", {
        body: { limit: 15, skip_trends: opts.skipTrends, skip_gsc: opts.skipGsc },
      });
      if (error) throw error;
      setMsg(`Frissítve: ${data?.count ?? 0} podcast`);
      await load();
    } catch (e: any) {
      setMsg(`Hiba: ${e?.message || e}`);
    } finally {
      setRunning(false);
    }
  };

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto py-8 sm:py-10 max-w-7xl space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="h-4 w-4" /> Admin Hub
            </Link>
            <h1 className="text-2xl sm:text-3xl font-semibold">Prefetch Targets</h1>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => runNow({ skipTrends: true })}
              disabled={running}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm disabled:opacity-50"
            >
              <SearchIcon className="h-4 w-4" /> Csak GSC
            </button>
            <button
              onClick={() => runNow()}
              disabled={running}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
              {running ? "Futás…" : "Teljes frissítés (GSC + Trends)"}
            </button>
          </div>
        </div>

        <p className="text-sm text-muted-foreground max-w-3xl">
          Kiszámítja, mely rendszeresen megjelenő HU podcastoknál éri meg <strong>prefetch placeholder oldal</strong>,{" "}
          <strong>cím-optimalizálás</strong> vagy <strong>új landing page</strong>. Adatforrás: DB kadencia + Google Search Console (utolsó 28 nap) + Apify Google Trends related/rising queries. „Gap" = Trends mutatja, de GSC-n nem érkezik ránk erre kattintás.
        </p>

        {msg && <div className="text-sm text-muted-foreground">{msg}</div>}

        {rows.length === 0 && (
          <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            Még nincs adat. Kattints a „Teljes frissítés" gombra az első futtatáshoz.
          </div>
        )}

        {rows.length > 0 && (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Podcast</th>
                    <th className="px-3 py-2 text-left">Kadencia</th>
                    <th className="px-3 py-2 text-right">GSC impr / klikk</th>
                    <th className="px-3 py-2 text-right">Ø poz.</th>
                    <th className="px-3 py-2 text-right">Trends (rel / rising)</th>
                    <th className="px-3 py-2 text-right">Gap</th>
                    <th className="px-3 py-2 text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <>
                      <tr
                        key={r.id}
                        className={`border-t border-border cursor-pointer hover:bg-muted/30 ${expanded === r.id ? "bg-muted/30" : ""}`}
                        onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                      >
                        <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {r.rank_label && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">{r.rank_label}</span>
                            )}
                            <span className="font-medium">{r.podcast_title}</span>
                            <a
                              href={`/podcast/${r.podcast_slug}`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {r.cadence_per_week}/hét · {r.cadence_pattern}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt(r.gsc_impressions_28d)} / {fmt(r.gsc_clicks_28d)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.gsc_avg_position ? r.gsc_avg_position.toFixed(1) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.trend_related_queries.length} / <span className="text-orange-500">{r.trend_rising_queries.length}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.gap_queries.length > 0 ? (
                            <span className="text-orange-500 font-medium">{r.gap_queries.length}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.priority_score}</td>
                      </tr>
                      {expanded === r.id && (
                        <tr className="border-t border-border bg-muted/20">
                          <td colSpan={8} className="px-3 py-4">
                            <div className="grid md:grid-cols-3 gap-4 text-xs">
                              <div>
                                <div className="uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                                  <SearchIcon className="h-3 w-3" /> GSC top queries (28d)
                                </div>
                                {r.gsc_top_queries.length === 0 && <div className="text-muted-foreground">—</div>}
                                <ul className="space-y-1">
                                  {r.gsc_top_queries.slice(0, 8).map((q, idx) => (
                                    <li key={idx} className="flex justify-between gap-2">
                                      <span className="truncate">{q.query}</span>
                                      <span className="text-muted-foreground tabular-nums">
                                        {q.impressions} · #{q.position}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <div>
                                <div className="uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                                  <TrendingUp className="h-3 w-3" /> Trends related
                                </div>
                                {r.trend_related_queries.length === 0 && <div className="text-muted-foreground">—</div>}
                                <ul className="space-y-1">
                                  {r.trend_related_queries.slice(0, 8).map((q, idx) => (
                                    <li key={idx}>{q}</li>
                                  ))}
                                </ul>
                              </div>
                              <div>
                                <div className="uppercase tracking-wider text-orange-500 mb-2 flex items-center gap-1">
                                  <Flame className="h-3 w-3" /> Rising + Gap
                                </div>
                                {r.trend_rising_queries.length > 0 && (
                                  <div className="mb-2">
                                    <div className="text-[10px] text-muted-foreground mb-1">Rising:</div>
                                    <ul className="space-y-1">
                                      {r.trend_rising_queries.slice(0, 6).map((q, idx) => (
                                        <li key={idx}>{q}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {r.gap_queries.length > 0 && (
                                  <div>
                                    <div className="text-[10px] text-muted-foreground mb-1">Gap (Trends van, GSC nincs):</div>
                                    <ul className="space-y-1">
                                      {r.gap_queries.slice(0, 6).map((q, idx) => (
                                        <li key={idx} className="text-orange-500">{q}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </div>
                            {r.suggested_actions.length > 0 && (
                              <div className="mt-4 pt-3 border-t border-border">
                                <div className="uppercase tracking-wider text-xs text-muted-foreground mb-2">Javasolt akció</div>
                                <ul className="space-y-1 text-xs">
                                  {r.suggested_actions.map((a, idx) => (
                                    <li key={idx} className="flex gap-2">
                                      <span className="text-primary">→</span>
                                      <span>{a}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {rows[0] && (
          <p className="text-xs text-muted-foreground">
            Utolsó számítás: {new Date(rows[0].last_computed_at).toLocaleString("hu-HU")}
          </p>
        )}
      </div>
    </Layout>
  );
}
