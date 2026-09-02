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
  if (path === "/categories" || path === "/kategoriak") return "/kategoriak";
  if (path === "/search" || path === "/kereses") return "/kereses";
  if (/^\/category\/[^/]+$/.test(path) || /^\/kategoria\/[^/]+$/.test(path)) return "/kategoria/:slug";
  if (/^\/podcast\/[^/]+\/[^/]+$/.test(path)) return "/podcast/:podcastSlug/:episodeSlug";
  if (/^\/podcast\/[^/]+$/.test(path)) return "/podcast/:podcastSlug";
  if (/^\/topic\/[^/]+$/.test(path) || /^\/tema\/[^/]+$/.test(path) || /^\/temak\/[^/]+$/.test(path)) return "/temak/:slug";
  if (/^\/person\/[^/]+$/.test(path) || /^\/szemely\/[^/]+$/.test(path) || /^\/szemelyek\/[^/]+$/.test(path)) return "/szemelyek/:slug";
  if (/^\/company\/[^/]+$/.test(path) || /^\/ceg\/[^/]+$/.test(path)) return "/ceg/:slug";
  if (/^\/ticker\/[^/]+$/.test(path)) return "/ticker/:symbol";
  if (/^\/ingredient\/[^/]+$/.test(path) || /^\/hozzavalo\/[^/]+$/.test(path)) return "/hozzavalo/:slug";
  if (/^\/moods?\/[^/]+$/.test(path) || /^\/hangulat(ok)?\/[^/]+$/.test(path)) return "/hangulatok/:slug";
  return path;
}

function classifyReferrer(referrer: string | null): string {
  if (!referrer) return "direkt / nincs referrer";
  const r = referrer.toLowerCase();
  if (r.includes("podiverzum")) return "belső";
  if (r.includes("google")) return "google";
  if (r.includes("bing")) return "bing";
  if (r.includes("chatgpt") || r.includes("openai")) return "chatgpt";
  if (r.includes("perplexity") || r.includes("claude") || r.includes("duckduckgo") || r.includes("yandex") || r.includes("ecosia")) return "egyéb kereső/AI";
  try { return new URL(referrer).hostname; } catch { return "egyéb"; }
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
      const { data: hasAdmin } = await supabase.rpc("has_role", { _user_id: uid, _role: "admin" });
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

    // Audience
    const humans = rows.filter((r) => !r.is_bot);
    const bots = rows.filter((r) => r.is_bot);
    const tallyField = (key: keyof Row, source: Row[] = humans) => {
      const m = new Map<string, number>();
      source.forEach((r) => {
        const v = (r[key] as string | null) || null;
        if (!v) return;
        m.set(v, (m.get(v) || 0) + 1);
      });
      return Array.from(m.entries()).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n);
    };
    const browsers = tallyField("ua_browser");
    const oses = tallyField("ua_os");
    const dwells = humans.map((r) => r.dwell_ms || 0).filter((d) => d > 0);
    const avgDwellSec = dwells.length ? Math.round(dwells.reduce((a, b) => a + b, 0) / dwells.length / 1000) : 0;
    const medianDwellSec = dwells.length ? Math.round(dwells.sort((a, b) => a - b)[Math.floor(dwells.length / 2)] / 1000) : 0;
    const sessions = new Map<string, number>();
    humans.forEach((r) => { if (r.session_id) sessions.set(r.session_id, (sessions.get(r.session_id) || 0) + 1); });
    const sessionCount = sessions.size;
    const avgPagesPerSession = sessionCount ? +(humans.filter(r => r.session_id).length / sessionCount).toFixed(2) : 0;
    const botShare = pct(bots.length, total);

    // ---- Entry points & bounce (session-level, humans only) ----
    // A globális bounce rate félrevezető: a látogatók többsége keresőből / ChatGPT-ből
    // érkezik közvetlenül entitás-oldalra, nem a főoldalra.
    const sessionMap = new Map<string, Row[]>();
    humans.forEach((r) => {
      if (!r.session_id) return;
      const arr = sessionMap.get(r.session_id) || [];
      arr.push(r);
      sessionMap.set(r.session_id, arr);
    });
    const entryMap = new Map<string, { source: string; landing: string; sessions: number; pages: number; bounced: number }>();
    sessionMap.forEach((evts) => {
      const sorted = [...evts].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const first = sorted[0];
      const landing = classifyRoute(first.path);
      const source = classifyReferrer(first.referrer);
      const k = `${source}|||${landing}`;
      const cur = entryMap.get(k) || { source, landing, sessions: 0, pages: 0, bounced: 0 };
      cur.sessions++;
      cur.pages += sorted.length;
      if (sorted.length === 1) cur.bounced++;
      entryMap.set(k, cur);
    });
    const entryPoints = Array.from(entryMap.values())
      .map((e) => ({
        ...e,
        pagesPerSession: +(e.pages / e.sessions).toFixed(2),
        bouncePct: pct(e.bounced, e.sessions),
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 25);

    const homeSessions = entryPoints.filter((e) => e.landing === "/");
    const deepSessions = entryPoints.filter((e) => e.landing !== "/");
    const sum = (arr: typeof entryPoints, key: "sessions" | "bounced") => arr.reduce((a, b) => a + b[key], 0);
    const deepEntryShare = pct(sum(deepSessions, "sessions"), sum(entryPoints, "sessions"));
    const searchBounce = (() => {
      const seo = entryPoints.filter((e) => ["google", "bing", "chatgpt", "egyéb kereső/AI"].includes(e.source));
      return { sessions: sum(seo, "sessions"), bouncePct: pct(sum(seo, "bounced"), sum(seo, "sessions")) };
    })();
    const homeBounce = { sessions: sum(homeSessions, "sessions"), bouncePct: pct(sum(homeSessions, "bounced"), sum(homeSessions, "sessions")) };

    return { total, unique, mobile, routes, topPaths, refs, days, utmSources, utmCampaigns, utmCombos, utmTagged, browsers, oses, avgDwellSec, medianDwellSec, sessionCount, avgPagesPerSession, botShare, botCount: bots.length, entryPoints, deepEntryShare, searchBounce, homeBounce };

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
          <Stat label="Sessions" value={stats.sessionCount.toLocaleString()} />
          <Stat label="Pages / session (avg)" value={String(stats.avgPagesPerSession)} />
          <Stat label="Avg dwell" value={`${stats.avgDwellSec}s (median ${stats.medianDwellSec}s)`} />
          <Stat label="Bot traffic" value={`${stats.botCount} (${stats.botShare}%)`} />
        </div>

        <section>
          <h2 className="font-semibold mb-1">Belépési pontok és bounce (humán sessionök)</h2>
          <p className="text-xs text-muted-foreground mb-3">
            A látogatók {stats.deepEntryShare}%-a nem a főoldalra, hanem közvetlenül entitás-oldalra érkezik
            (kereső / ChatGPT). Ezért az aggregált bounce rate félrevezető — forrás + landing bontásban nézd.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <Stat label="Deep-landing arány" value={`${stats.deepEntryShare}%`} />
            <Stat label="Kereső/AI bounce" value={`${stats.searchBounce.bouncePct}% (${stats.searchBounce.sessions} session)`} />
            <Stat label="Főoldalra érkezők bounce" value={`${stats.homeBounce.bouncePct}% (${stats.homeBounce.sessions} session)`} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-xs">
                <tr>
                  <th className="text-left px-3 py-2">Forrás</th>
                  <th className="text-left px-3 py-2">Belépő oldal</th>
                  <th className="text-right px-3 py-2">Session</th>
                  <th className="text-right px-3 py-2">Oldal/session</th>
                  <th className="text-right px-3 py-2">Bounce</th>
                </tr>
              </thead>
              <tbody>
                {stats.entryPoints.map((e) => (
                  <tr key={`${e.source}-${e.landing}`} className="border-t border-border">
                    <td className="px-3 py-2">{e.source}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.landing}</td>
                    <td className="px-3 py-2 text-right">{e.sessions}</td>
                    <td className="px-3 py-2 text-right">{e.pagesPerSession}</td>
                    <td className="px-3 py-2 text-right">{e.bouncePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UtmTable title="Browser (humans)" rows={stats.browsers} />
          <UtmTable title="Operating system (humans)" rows={stats.oses} />
        </section>

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
