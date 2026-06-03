import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useNoindex } from "@/lib/useNoindex";

type Row = {
  id: string;
  path: string;
  full_url: string | null;
  user_id: string | null;
  referrer: string | null;
  created_at: string;
};

const ACTIVE_WINDOW_MIN = 5;
const REFRESH_MS = 20_000;

function classifyRoute(path: string): string {
  if (path === "/") return "/";
  if (/^\/(category|kategoria)\/[^/]+$/.test(path)) return "/kategoria/:slug";
  if (/^\/podcast\/[^/]+\/[^/]+$/.test(path)) return "/podcast/:p/:e";
  if (/^\/podcast\/[^/]+$/.test(path)) return "/podcast/:p";
  if (/^\/(topic|tema|temak)\/[^/]+$/.test(path)) return "/temak/:slug";
  if (/^\/(person|szemely|szemelyek)\/[^/]+$/.test(path)) return "/szemelyek/:slug";
  if (/^\/(company|ceg)\/[^/]+$/.test(path)) return "/ceg/:slug";
  if (/^\/ticker\/[^/]+$/.test(path)) return "/ticker/:s";
  if (/^\/(mood|moods|hangulat|hangulatok)\/[^/]+$/.test(path)) return "/hangulatok/:slug";
  return path;
}

function visitorKey(r: Row): string {
  return r.user_id || r.full_url || r.path;
}

export default function AdminLivePage() {
  useNoindex("Admin · Élő — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [recent, setRecent] = useState<Row[]>([]);
  const [todayCount, setTodayCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: uid, _role: "admin" });
      setIsAdmin(hasAdmin === true);
      setReady(true);
    })();
  }, [nav]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const sinceActive = new Date(Date.now() - ACTIVE_WINDOW_MIN * 60_000).toISOString();
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const [{ data: r }, { count: total }] = await Promise.all([
          supabase
            .from("page_events")
            .select("id,path,full_url,user_id,referrer,created_at")
            .gte("created_at", sinceActive)
            .order("created_at", { ascending: false })
            .limit(500),
          supabase
            .from("page_events")
            .select("id", { count: "exact", head: true })
            .gte("created_at", startOfDay.toISOString()),
        ]);

        if (cancelled) return;
        setRecent((r as Row[]) || []);
        setTodayCount(total || 0);
        setLastRefreshed(new Date());
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const id = window.setInterval(load, REFRESH_MS);
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => { cancelled = true; window.clearInterval(id); window.clearInterval(t); };
  }, [isAdmin]);

  const stats = useMemo(() => {
    const now = Date.now();
    const visitors = new Map<string, { key: string; lastAt: number; lastPath: string; views: number }>();
    recent.forEach((r) => {
      const k = visitorKey(r);
      const ts = new Date(r.created_at).getTime();
      const cur = visitors.get(k);
      if (!cur || ts > cur.lastAt) {
        visitors.set(k, { key: k, lastAt: ts, lastPath: r.path, views: (cur?.views || 0) + 1 });
      } else {
        cur.views++;
      }
    });
    const active = Array.from(visitors.values()).sort((a, b) => b.lastAt - a.lastAt);

    const byRoute = new Map<string, number>();
    recent.forEach((r) => {
      const k = classifyRoute(r.path);
      byRoute.set(k, (byRoute.get(k) || 0) + 1);
    });
    const topRoutes = Array.from(byRoute.entries()).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 8);

    const byPath = new Map<string, number>();
    recent.forEach((r) => {
      byPath.set(r.path, (byPath.get(r.path) || 0) + 1);
    });
    const topPaths = Array.from(byPath.entries()).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 10);

    const pulse: number[] = new Array(60).fill(0);
    recent.forEach((r) => {
      const ageSec = Math.floor((now - new Date(r.created_at).getTime()) / 1000);
      if (ageSec >= 0 && ageSec < 60) pulse[59 - ageSec]++;
    });

    return { active, topRoutes, topPaths, pulse };
  }, [recent, tick]);

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Betöltés…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Nincs jogosultság.</div></Layout>;

  const maxPulse = Math.max(1, ...stats.pulse);

  return (
    <Layout>
      <div className="container mx-auto py-10 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-semibold flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              Élő látogatók
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Utolsó {ACTIVE_WINDOW_MIN} perc · automatikus frissítés {REFRESH_MS / 1000} másodpercenként
              {lastRefreshed && <> · frissítve {lastRefreshed.toLocaleTimeString()}</>}
              {loading && <span className="ml-2 text-xs">frissítés…</span>}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Aktív látogatók" value={stats.active.length.toLocaleString()} accent />
          <Stat label="Oldalmegtekintés (5 perc)" value={recent.length.toLocaleString()} />
          <Stat label="Oldalmegtekintés ma" value={todayCount.toLocaleString()} />
        </div>

        <section>
          <h2 className="font-semibold mb-2">Pulzus — utolsó 60 másodperc</h2>
          <div className="flex items-end gap-[2px] h-20 p-3 rounded-lg border border-border bg-card">
            {stats.pulse.map((n, i) => (
              <div
                key={i}
                className="flex-1 bg-emerald-500/70 rounded-sm"
                style={{ height: `${(n / maxPulse) * 100}%`, minHeight: n ? 2 : 0 }}
                title={`${60 - i}s ezelőtt: ${n} megtekintés`}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Ki van itt most</h2>
          {stats.active.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nincs aktív látogató az elmúlt {ACTIVE_WINDOW_MIN} percben.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">Látogató</th>
                    <th className="text-left px-3 py-2">Utolsó oldal</th>
                    <th className="text-right px-3 py-2">Megtekintés</th>
                    <th className="text-right px-3 py-2">Utoljára</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.active.slice(0, 50).map((v) => {
                    const ageSec = Math.max(0, Math.floor((Date.now() - v.lastAt) / 1000));
                    return (
                      <tr key={v.key} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs truncate max-w-[200px]">{v.key.slice(0, 24)}</td>
                        <td className="px-3 py-2"><a href={v.lastPath} className="hover:underline">{v.lastPath}</a></td>
                        <td className="px-3 py-2 text-right">{v.views}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{ageSec}s</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section>
            <h2 className="font-semibold mb-2">Top útvonalak (utolsó 5 perc)</h2>
            <MiniTable rows={stats.topRoutes} />
          </section>
          <section>
            <h2 className="font-semibold mb-2">Top oldalak (utolsó 5 perc)</h2>
            <MiniTable rows={stats.topPaths} linkify />
          </section>
        </div>
      </div>
    </Layout>
  );
}

function MiniTable({ rows, linkify = false }: { rows: { k: string; n: number }[]; linkify?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nincs adat.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} className="border-t border-border first:border-t-0">
              <td className="px-3 py-2">
                {linkify ? <a href={r.k} className="hover:underline">{r.k}</a> : <span className="font-mono text-xs">{r.k}</span>}
              </td>
              <td className="px-3 py-2 text-right w-16">{r.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`p-4 rounded-lg border bg-card ${accent ? "border-emerald-500/40" : "border-border"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accent ? "text-emerald-500" : ""}`}>{value}</div>
    </div>
  );
}
