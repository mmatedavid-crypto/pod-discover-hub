import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useNoindex } from "@/lib/useNoindex";

type Row = {
  id: string;
  path: string;
  full_url: string | null;
  referrer: string | null;
  viewport_width: number | null;
  user_id: string | null;
  created_at: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  session_id: string | null;
  dwell_ms: number | null;
  ua_browser: string | null;
  ua_os: string | null;
  is_bot: boolean | null;
};

function classifyRoute(path: string): string {
  if (path === "/") return "/";
  if (path === "/categories") return "/categories";
  if (path === "/search") return "/search";
  if (/^\/category\/[^/]+$/.test(path)) return "/category/:slug";
  if (/^\/podcast\/[^/]+\/[^/]+$/.test(path)) return "/podcast/:podcastSlug/:episodeSlug";
  if (/^\/podcast\/[^/]+$/.test(path)) return "/podcast/:podcastSlug";
  if (/^\/topic\/[^/]+$/.test(path)) return "/topic/:slug";
  if (/^\/person\/[^/]+$/.test(path)) return "/person/:slug";
  if (/^\/company\/[^/]+$/.test(path)) return "/company/:slug";
  if (/^\/ticker\/[^/]+$/.test(path)) return "/ticker/:symbol";
  if (/^\/ingredient\/[^/]+$/.test(path)) return "/ingredient/:slug";
  return path;
}

export default function AdminAnalyticsPage() {
  useNoindex("Admin · Analytics — Podiverzum");
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
          .from("page_events")
          .select("id,path,full_url,referrer,viewport_width,user_id,created_at,utm_source,utm_medium,utm_campaign,utm_term,utm_content,session_id,dwell_ms,ua_browser,ua_os,is_bot")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(10000);
        setRows((r as Row[]) || []);
      }
      setReady(true);
    })();
  }, [nav, windowDays]);

  const stats = useMemo(() => {
    const total = rows.length;
    const unique = new Set(rows.map((r) => r.user_id || r.full_url || r.path)).size;
    const mobile = rows.filter((r) => (r.viewport_width || 0) > 0 && (r.viewport_width || 0) < 768).length;

    const byRoute = new Map<string, { route: string; n: number }>();
    rows.forEach((r) => {
      const k = classifyRoute(r.path);
      const cur = byRoute.get(k) || { route: k, n: 0 };
      cur.n++;
      byRoute.set(k, cur);
    });
    const routes = Array.from(byRoute.values()).sort((a, b) => b.n - a.n);

    const byPath = new Map<string, { path: string; n: number }>();
    rows.forEach((r) => {
      const cur = byPath.get(r.path) || { path: r.path, n: 0 };
      cur.n++;
      byPath.set(r.path, cur);
    });
    const topPaths = Array.from(byPath.values()).sort((a, b) => b.n - a.n).slice(0, 50);

    const byReferrer = new Map<string, number>();
    rows.forEach((r) => {
      let host = "(direct)";
      if (r.referrer) {
        try { host = new URL(r.referrer).hostname; } catch { host = r.referrer; }
        if (host === window.location.hostname) host = "(internal)";
      }
      byReferrer.set(host, (byReferrer.get(host) || 0) + 1);
    });
    const refs = Array.from(byReferrer.entries()).map(([host, n]) => ({ host, n })).sort((a, b) => b.n - a.n).slice(0, 20);

    // simple per-day series
    const byDay = new Map<string, number>();
    rows.forEach((r) => {
      const d = r.created_at.slice(0, 10);
      byDay.set(d, (byDay.get(d) || 0) + 1);
    });
    const days = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    // UTM tallies
    const tally = (key: keyof Row) => {
      const m = new Map<string, number>();
      rows.forEach((r) => {
        const v = (r[key] as string | null) || null;
        if (!v) return;
        m.set(v, (m.get(v) || 0) + 1);
      });
      return Array.from(m.entries()).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 20);
    };
    const utmSources = tally("utm_source");
    const utmCampaigns = tally("utm_campaign");

    const comboMap = new Map<string, number>();
    rows.forEach((r) => {
      if (!r.utm_source && !r.utm_medium) return;
      const k = `${r.utm_source || "(none)"} / ${r.utm_medium || "(none)"}`;
      comboMap.set(k, (comboMap.get(k) || 0) + 1);
    });
    const utmCombos = Array.from(comboMap.entries()).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 20);
    const utmTagged = rows.filter((r) => r.utm_source || r.utm_medium || r.utm_campaign).length;

    return { total, unique, mobile, routes, topPaths, refs, days, utmSources, utmCampaigns, utmCombos, utmTagged };
  }, [rows]);

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Not authorized.</div></Layout>;

  const maxDay = Math.max(1, ...stats.days.map(([, n]) => n));

  return (
    <Layout>
      <div className="container mx-auto py-10 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-3xl font-semibold">Analytics</h1>
          <div className="flex gap-2 text-xs">
            {([1, 7, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className={`px-2.5 py-1 rounded-full border ${windowDays === d ? "bg-foreground text-background border-foreground" : "bg-card border-border"}`}
              >
                Last {d}d
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Page views" value={stats.total.toLocaleString()} />
          <Stat label="Approx. unique visitors" value={stats.unique.toLocaleString()} />
          <Stat label="Mobile views" value={`${stats.mobile} (${pct(stats.mobile, stats.total)}%)`} />
          <Stat label="Days with data" value={stats.days.length.toString()} />
        </div>

        <section>
          <h2 className="font-semibold mb-2">Daily trend</h2>
          {stats.days.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <div className="flex items-end gap-1 h-32 p-3 rounded-lg border border-border bg-card">
              {stats.days.map(([d, n]) => (
                <div key={d} className="flex-1 flex flex-col items-center gap-1" title={`${d}: ${n}`}>
                  <div className="w-full bg-primary/70 rounded-sm" style={{ height: `${(n / maxDay) * 100}%` }} />
                  <div className="text-[10px] text-muted-foreground truncate">{d.slice(5)}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-semibold mb-2">Views by route</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-xs">
                <tr>
                  <th className="text-left px-3 py-2">Route</th>
                  <th className="text-right px-3 py-2">Views</th>
                  <th className="text-right px-3 py-2">Share</th>
                </tr>
              </thead>
              <tbody>
                {stats.routes.map((r) => (
                  <tr key={r.route} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{r.route}</td>
                    <td className="px-3 py-2 text-right">{r.n}</td>
                    <td className="px-3 py-2 text-right">{pct(r.n, stats.total)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Top pages</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-xs">
                <tr>
                  <th className="text-left px-3 py-2">Path</th>
                  <th className="text-right px-3 py-2">Views</th>
                </tr>
              </thead>
              <tbody>
                {stats.topPaths.map((r) => (
                  <tr key={r.path} className="border-t border-border">
                    <td className="px-3 py-2"><a href={r.path} className="hover:underline">{r.path}</a></td>
                    <td className="px-3 py-2 text-right">{r.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Top referrers</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-xs">
                <tr>
                  <th className="text-left px-3 py-2">Source</th>
                  <th className="text-right px-3 py-2">Views</th>
                </tr>
              </thead>
              <tbody>
                {stats.refs.map((r) => (
                  <tr key={r.host} className="border-t border-border">
                    <td className="px-3 py-2">{r.host}</td>
                    <td className="px-3 py-2 text-right">{r.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Campaign attribution (UTM)</h2>
          <p className="text-xs text-muted-foreground mb-3">
            {stats.utmTagged.toLocaleString()} of {stats.total.toLocaleString()} views ({pct(stats.utmTagged, stats.total)}%) carried UTM parameters.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UtmTable title="Top sources (utm_source)" rows={stats.utmSources} />
            <UtmTable title="Top campaigns (utm_campaign)" rows={stats.utmCampaigns} />
            <div className="md:col-span-2">
              <UtmTable title="Source / Medium" rows={stats.utmCombos} />
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}

function UtmTable({ title, rows }: { title: string; rows: { k: string; n: number }[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-xs">
              <tr>
                <th className="text-left px-3 py-2">Value</th>
                <th className="text-right px-3 py-2">Views</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k} className="border-t border-border">
                  <td className="px-3 py-2 break-all">{r.k}</td>
                  <td className="px-3 py-2 text-right">{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
